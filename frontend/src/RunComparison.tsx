import { useEffect, useMemo, useState } from "react";
import { getRunDetails } from "./api";
import type { RunDetails, TestCaseDetails, TestRun, TestCaseStatus } from "./api";

type RunComparisonProps = {
  runs: TestRun[];
  isLoadingRuns: boolean;
};

type ChangeKind = "regressed" | "fixed" | "changed" | "added" | "removed" | "unchanged";
type ComparisonFilter = "all" | "regressed" | "fixed" | "changed" | "added" | "removed";

type ComparedCase = {
  key: string;
  name: string;
  className: string;
  before: TestCaseDetails | null;
  after: TestCaseDetails | null;
  change: ChangeKind;
};

type ComparisonResult = {
  baseline: RunDetails;
  compared: RunDetails;
  cases: ComparedCase[];
};

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown date";
  return date.toLocaleString(undefined, {
    month: "short",
    day: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getErrorMessage(error: unknown): string {
  if (error instanceof TypeError) {
    return "Could not reach the API. Check your network connection and the backend service status.";
  }
  return error instanceof Error ? error.message : "Could not compare these test runs.";
}

function caseKey(testCase: TestCaseDetails): string {
  return `${(testCase.class_name || testCase.suite).toLowerCase()}::${testCase.name.toLowerCase()}`;
}

function isFailure(status: TestCaseStatus): boolean {
  return status === "failed" || status === "error";
}

function classifyChange(
  before: TestCaseDetails | null,
  after: TestCaseDetails | null
): ChangeKind {
  if (!before && after) return "added";
  if (before && !after) return "removed";
  if (!before || !after) return "unchanged";

  if (!isFailure(before.status) && isFailure(after.status)) return "regressed";
  if (isFailure(before.status) && !isFailure(after.status)) return "fixed";
  if (before.status !== after.status || before.message !== after.message) return "changed";
  return "unchanged";
}

function compareDetails(baseline: RunDetails, compared: RunDetails): ComparedCase[] {
  const beforeByKey = new Map<string, TestCaseDetails>();
  const afterByKey = new Map<string, TestCaseDetails>();

  baseline.test_cases.forEach((testCase) => beforeByKey.set(caseKey(testCase), testCase));
  compared.test_cases.forEach((testCase) => afterByKey.set(caseKey(testCase), testCase));

  const keys = new Set([...beforeByKey.keys(), ...afterByKey.keys()]);
  const priority: Record<ChangeKind, number> = {
    regressed: 0,
    fixed: 1,
    changed: 2,
    added: 3,
    removed: 4,
    unchanged: 5,
  };

  return Array.from(keys)
    .map((key) => {
      const before = beforeByKey.get(key) ?? null;
      const after = afterByKey.get(key) ?? null;
      const testCase = after ?? before;
      return {
        key,
        name: testCase?.name ?? "Unknown test",
        className: testCase?.class_name || testCase?.suite || "Unknown test class",
        before,
        after,
        change: classifyChange(before, after),
      };
    })
    .sort(
      (left, right) =>
        priority[left.change] - priority[right.change] ||
        left.className.localeCompare(right.className) ||
        left.name.localeCompare(right.name)
    );
}

function statusLabel(status: TestCaseStatus | undefined): string {
  if (!status) return "Not present";
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function RunStatus({ status }: { status: TestCaseStatus | undefined }) {
  if (!status) return <span className="comparison-status missing">Not present</span>;
  return <span className={`comparison-status ${status}`}>{statusLabel(status)}</span>;
}

export default function RunComparison({ runs, isLoadingRuns }: RunComparisonProps) {
  const sortedRuns = useMemo(
    () => [...runs].sort((left, right) => new Date(right.created_at).getTime() - new Date(left.created_at).getTime()),
    [runs]
  );
  const [baselineRunId, setBaselineRunId] = useState<number | "">("");
  const [comparedRunId, setComparedRunId] = useState<number | "">("");
  const [comparison, setComparison] = useState<ComparisonResult | null>(null);
  const [isComparing, setIsComparing] = useState(false);
  const [error, setError] = useState("");
  const [activeFilter, setActiveFilter] = useState<ComparisonFilter>("all");

  useEffect(() => {
    if (sortedRuns.length === 0) {
      setBaselineRunId("");
      setComparedRunId("");
      setComparison(null);
      setActiveFilter("all");
      return;
    }

    setBaselineRunId((current) =>
      current !== "" && sortedRuns.some((run) => run.id === current)
        ? current
        : sortedRuns.length > 1
          ? sortedRuns[1].id
          : ""
    );
    setComparedRunId((current) =>
      current !== "" && sortedRuns.some((run) => run.id === current)
        ? current
        : sortedRuns[0].id
    );
  }, [sortedRuns]);

  async function handleCompare() {
    if (baselineRunId === "" || comparedRunId === "" || baselineRunId === comparedRunId) {
      setError("Choose two different test runs to compare.");
      return;
    }

    setIsComparing(true);
    setError("");
    setActiveFilter("all");

    try {
      const [baseline, compared] = await Promise.all([
        getRunDetails(baselineRunId),
        getRunDetails(comparedRunId),
      ]);
      setComparison({
        baseline,
        compared,
        cases: compareDetails(baseline, compared),
      });
    } catch (err) {
      setComparison(null);
      setError(getErrorMessage(err));
    } finally {
      setIsComparing(false);
    }
  }

  const changeCounts = useMemo(() => {
    const cases = comparison?.cases ?? [];
    return {
      regressions: cases.filter((item) => item.change === "regressed").length,
      fixes: cases.filter((item) => item.change === "fixed").length,
      changed: cases.filter((item) => item.change === "changed").length,
      added: cases.filter((item) => item.change === "added").length,
      removed: cases.filter((item) => item.change === "removed").length,
      unchanged: cases.filter((item) => item.change === "unchanged").length,
    };
  }, [comparison]);

  const filteredCases = useMemo(() => {
    const cases = comparison?.cases ?? [];
    if (activeFilter === "all") return cases;
    return cases.filter((item) => item.change === activeFilter);
  }, [comparison, activeFilter]);

  const filterOptions: Array<{
    key: ComparisonFilter;
    label: string;
    count: number;
  }> = [
    { key: "all", label: "All", count: comparison?.cases.length ?? 0 },
    { key: "regressed", label: "Regressions", count: changeCounts.regressions },
    { key: "fixed", label: "Fixed", count: changeCounts.fixes },
    { key: "changed", label: "Changed", count: changeCounts.changed },
    { key: "added", label: "Added", count: changeCounts.added },
    { key: "removed", label: "Removed", count: changeCounts.removed },
  ];

  return (
    <section className="panel run-comparison-panel" id="run-comparison">
      <div className="panel-header comparison-header">
        <div>
          <h2>Test history comparison</h2>
          <p>Compare two saved runs to find regressions, fixes, and status changes</p>
        </div>
        <span className="comparison-label">Run diff</span>
      </div>

      {sortedRuns.length < 2 ? (
        <div className="insights-empty">
          <strong>Two saved runs are needed</strong>
          <p>Import another JUnit report to compare test history between runs.</p>
        </div>
      ) : (
        <>
          <div className="comparison-controls">
            <label>
              <span>Baseline run</span>
              <select
                value={baselineRunId}
                onChange={(event) => {
                  setBaselineRunId(event.target.value ? Number(event.target.value) : "");
                  setComparison(null);
                  setActiveFilter("all");
                  setError("");
                }}
                disabled={isComparing || isLoadingRuns}
              >
                <option value="">Select baseline</option>
                {sortedRuns.map((run) => (
                  <option value={run.id} key={run.id}>
                    Run #{run.id} · {run.filename} · {formatDate(run.created_at)}
                  </option>
                ))}
              </select>
            </label>

            <span className="comparison-versus" aria-hidden="true">→</span>

            <label>
              <span>Compare with</span>
              <select
                value={comparedRunId}
                onChange={(event) => {
                  setComparedRunId(event.target.value ? Number(event.target.value) : "");
                  setComparison(null);
                  setActiveFilter("all");
                  setError("");
                }}
                disabled={isComparing || isLoadingRuns}
              >
                <option value="">Select comparison run</option>
                {sortedRuns.map((run) => (
                  <option value={run.id} key={run.id}>
                    Run #{run.id} · {run.filename} · {formatDate(run.created_at)}
                  </option>
                ))}
              </select>
            </label>

            <button
              type="button"
              className="insights-action comparison-button"
              onClick={() => void handleCompare()}
              disabled={isComparing || isLoadingRuns || baselineRunId === "" || comparedRunId === "" || baselineRunId === comparedRunId}
            >
              {isComparing ? "Comparing…" : "Compare runs"}
            </button>
          </div>

          {baselineRunId !== "" && comparedRunId !== "" && baselineRunId === comparedRunId && (
            <p className="comparison-validation" role="status">Choose two different runs to see changes.</p>
          )}
        </>
      )}

      {error && <div className="details-error comparison-error" role="alert">{error}</div>}

      {isComparing && <p className="details-state" role="status">Loading both reports and comparing test cases…</p>}

      {comparison && !isComparing && (
        <>
          <div className="comparison-run-heading">
            <span><strong>Baseline:</strong> Run #{comparison.baseline.id} · {formatDate(comparison.baseline.created_at)}</span>
            <span><strong>Compared:</strong> Run #{comparison.compared.id} · {formatDate(comparison.compared.created_at)}</span>
          </div>

          <div className="comparison-summary" aria-label="Comparison summary">
            <div className="regressed"><span>Regressions</span><strong>{changeCounts.regressions}</strong></div>
            <div className="fixed"><span>Fixed</span><strong>{changeCounts.fixes}</strong></div>
            <div className="changed"><span>Other changes</span><strong>{changeCounts.changed}</strong></div>
            <div className="added"><span>Added</span><strong>{changeCounts.added}</strong></div>
            <div className="removed"><span>Removed</span><strong>{changeCounts.removed}</strong></div>
          </div>

          {comparison.cases.length === 0 ? (
            <div className="insights-empty">
              <strong>No test cases were found in these reports</strong>
              <p>The selected JUnit reports do not contain comparable individual test cases.</p>
            </div>
          ) : (
            <>
              <div
                className="range-switcher comparison-filter-controls"
                role="group"
                aria-label="Filter comparison results"
                style={{ flexWrap: "wrap", marginBottom: "14px" }}
              >
                {filterOptions.map((option) => (
                  <button
                    type="button"
                    key={option.key}
                    className={activeFilter === option.key ? "range-active" : ""}
                    aria-pressed={activeFilter === option.key}
                    onClick={() => setActiveFilter(option.key)}
                  >
                    {option.label}
                    <span style={{ marginLeft: "5px", opacity: 0.8 }}>{option.count}</span>
                  </button>
                ))}
              </div>

              {filteredCases.length === 0 ? (
                <div className="insights-empty">
                  <strong>No tests in this category</strong>
                  <p>Choose All to display every test in this comparison.</p>
                </div>
              ) : (
                <div className="comparison-table-wrap">
                  <table className="comparison-table">
                    <thead>
                      <tr>
                        <th>TEST</th>
                        <th>BASELINE</th>
                        <th>COMPARED</th>
                        <th>CHANGE</th>
                        <th>DETAIL</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredCases.map((item) => (
                        <tr key={item.key} className={`comparison-row ${item.change}`}>
                          <td>
                            <strong>{item.name}</strong>
                            <small>{item.className}</small>
                          </td>
                          <td><RunStatus status={item.before?.status} /></td>
                          <td><RunStatus status={item.after?.status} /></td>
                          <td><span className={`comparison-change ${item.change}`}>{item.change}</span></td>
                          <td>
                            {item.change === "regressed" && (item.after?.message || "The test now fails or errors.")}
                            {item.change === "fixed" && "Previously failing test now passes or skips."}
                            {item.change === "changed" && (item.after?.message || "Test status or failure message changed.")}
                            {item.change === "added" && "Test appears only in the compared run."}
                            {item.change === "removed" && "Test appears only in the baseline run."}
                            {item.change === "unchanged" && (isFailure(item.after?.status ?? "passed") ? item.after?.message || "Failure status unchanged." : "No status change.")}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </>
      )}

      <p className="comparison-footnote">
        Regressions are tests that were not failing in the baseline but fail or error in the compared run. Test matching uses class name and test name.
      </p>
    </section>
  );
}
