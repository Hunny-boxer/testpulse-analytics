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

function csvCell(value: string | number | null | undefined): string {
  const text = value == null ? "" : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function escapeHtml(value: string | number | null | undefined): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function statusForCsv(testCase: TestCaseDetails | null): string {
  return testCase ? statusLabel(testCase.status) : "Not present";
}

function changeDetail(item: ComparedCase): string {
  switch (item.change) {
    case "regressed":
      return item.after?.message || "The test now fails or errors.";
    case "fixed":
      return "Previously failing test now passes or skips.";
    case "changed":
      return item.after?.message || "Test status or failure message changed.";
    case "added":
      return "Test appears only in the compared run.";
    case "removed":
      return "Test appears only in the baseline run.";
    case "unchanged":
      return isFailure(item.after?.status ?? "passed")
        ? item.after?.message || "Failure status unchanged."
        : "No status change.";
  }

  return "No status change.";
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
  const [exportNotice, setExportNotice] = useState("");

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

  const allCases = comparison?.cases ?? [];
  const filteredCases =
    activeFilter === "all"
      ? allCases
      : allCases.filter((item) => item.change === activeFilter);

  function handleExportCsv() {
    if (!comparison || filteredCases.length === 0) return;

    const headers = [
      "Baseline Run ID",
      "Baseline Filename",
      "Baseline Created At",
      "Compared Run ID",
      "Compared Filename",
      "Compared Created At",
      "Test Class",
      "Test Name",
      "Baseline Status",
      "Compared Status",
      "Change",
      "Detail",
    ];

    const rows = filteredCases.map((item) => [
      comparison.baseline.id,
      comparison.baseline.filename,
      comparison.baseline.created_at,
      comparison.compared.id,
      comparison.compared.filename,
      comparison.compared.created_at,
      item.className,
      item.name,
      statusForCsv(item.before),
      statusForCsv(item.after),
      item.change,
      changeDetail(item),
    ]);

    const csv = "\uFEFF" + [headers, ...rows]
      .map((row) => row.map(csvCell).join(","))
      .join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = `testpulse-comparison-run-${comparison.baseline.id}-vs-run-${comparison.compared.id}-${activeFilter}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);

    setExportNotice(
      `Exported ${filteredCases.length} test case${filteredCases.length === 1 ? "" : "s"} to CSV.`
    );
  }

  function handleExportPdf() {
    if (!comparison || filteredCases.length === 0) return;

    // Open synchronously from the button click so popup blockers are less likely to block it.
    const reportWindow = window.open("", "_blank");
    if (!reportWindow) {
      setExportNotice("The report window was blocked. Allow pop-ups for this dashboard and try again.");
      return;
    }

    const summaryCards = [
      ["Tests compared", comparison.cases.length],
      ["Regressions", changeCounts.regressions],
      ["Fixed", changeCounts.fixes],
      ["Changed", changeCounts.changed],
      ["Added", changeCounts.added],
      ["Removed", changeCounts.removed],
    ];

    const summaryHtml = summaryCards
      .map(([label, count]) => `
        <div class="metric">
          <span>${escapeHtml(label)}</span>
          <strong>${escapeHtml(count)}</strong>
        </div>
      `)
      .join("");

    const rowsHtml = filteredCases
      .map((item) => `
        <tr>
          <td><strong>${escapeHtml(item.name)}</strong></td>
          <td>${escapeHtml(item.className)}</td>
          <td><span class="status status-${item.before?.status ?? "missing"}">${escapeHtml(statusForCsv(item.before))}</span></td>
          <td><span class="status status-${item.after?.status ?? "missing"}">${escapeHtml(statusForCsv(item.after))}</span></td>
          <td><span class="change change-${item.change}">${escapeHtml(item.change)}</span></td>
          <td>${escapeHtml(changeDetail(item))}</td>
        </tr>
      `)
      .join("");

    const filterLabel = filterOptions.find((option) => option.key === activeFilter)?.label ?? "All";
    const generatedAt = new Date().toLocaleString();

    const reportHtml = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>TestPulse Comparison Report - Run #${comparison.baseline.id} vs Run #${comparison.compared.id}</title>
  <style>
    @page { size: A4 landscape; margin: 12mm; }
    * { box-sizing: border-box; }
    body { margin: 0; color: #20202a; background: #fff; font: 10px/1.5 Arial, Helvetica, sans-serif; }
    .report { max-width: 1400px; margin: 0 auto; }
    .topline { color: #7352c7; font-size: 9px; font-weight: 700; letter-spacing: 1.5px; text-transform: uppercase; margin: 0 0 5px; }
    h1 { margin: 0; color: #211936; font-size: 25px; letter-spacing: -0.5px; }
    .subtitle { margin: 5px 0 0; color: #666174; font-size: 10px; }
    .header { display: flex; justify-content: space-between; align-items: flex-end; gap: 20px; border-bottom: 2px solid #8b6ce0; padding-bottom: 14px; margin-bottom: 16px; }
    .generated { color: #756f80; text-align: right; font-size: 9px; white-space: nowrap; }
    .run-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin: 0 0 17px; }
    .run-card { border: 1px solid #e2dced; border-radius: 7px; padding: 11px 13px; background: #fbfaff; min-width: 0; }
    .run-label { display: block; color: #75658f; font-size: 8px; font-weight: 700; letter-spacing: 1px; text-transform: uppercase; margin-bottom: 3px; }
    .run-card strong { display: block; color: #251a3d; font-size: 13px; margin-bottom: 2px; }
    .run-file { display: block; color: #514963; overflow-wrap: anywhere; }
    .run-date { display: block; color: #777083; font-size: 9px; margin-top: 3px; }
    .section-title { display: flex; align-items: baseline; justify-content: space-between; gap: 14px; margin: 0 0 9px; }
    h2 { margin: 0; color: #28203a; font-size: 13px; }
    .filter-meta { color: #6d657a; font-size: 9px; text-align: right; }
    .metrics { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 8px; margin-bottom: 18px; }
    .metric { min-width: 0; border: 1px solid #e6e0ef; border-radius: 7px; padding: 9px 11px; }
    .metric span { display: block; color: #6d657a; font-size: 9px; }
    .metric strong { display: block; margin-top: 3px; color: #2b2141; font-size: 20px; }
    .metric:nth-child(2) strong { color: #c03955; }
    .metric:nth-child(3) strong { color: #167b58; }
    .table-wrap { border: 1px solid #e1dce9; border-radius: 7px; overflow: hidden; }
    table { width: 100%; border-collapse: collapse; table-layout: fixed; }
    thead { display: table-header-group; }
    th { padding: 8px 9px; background: #f2eef9; color: #443657; text-align: left; font-size: 8px; letter-spacing: .5px; text-transform: uppercase; border-bottom: 1px solid #dcd4eb; }
    td { padding: 8px 9px; vertical-align: top; border-bottom: 1px solid #eeeaf4; overflow-wrap: anywhere; font-size: 9px; }
    tbody tr:nth-child(even) { background: #fbfaff; }
    tbody tr:last-child td { border-bottom: 0; }
    th:nth-child(1) { width: 17%; } th:nth-child(2) { width: 18%; } th:nth-child(3) { width: 11%; } th:nth-child(4) { width: 11%; } th:nth-child(5) { width: 10%; } th:nth-child(6) { width: 33%; }
    .status, .change { display: inline-block; border-radius: 4px; padding: 3px 6px; font-weight: 700; font-size: 8px; background: #f1eff5; color: #665c73; }
    .status-passed, .change-fixed { background: #e7f7ef; color: #13784f; }
    .status-failed, .status-error, .change-regressed { background: #fde9ed; color: #b32642; }
    .status-skipped, .status-missing { background: #edf2f8; color: #55677c; }
    .change-changed { background: #f0eaff; color: #6f49bd; }
    .change-added { background: #e5f5fc; color: #17698e; }
    .change-removed { background: #fff1df; color: #975813; }
    .notes { margin-top: 12px; color: #777083; font-size: 9px; }
    .footer { display: flex; justify-content: space-between; gap: 12px; margin-top: 18px; padding-top: 8px; border-top: 1px solid #e3deeb; color: #81798d; font-size: 8px; }
    .print-hint { margin-top: 12px; padding: 9px 10px; border: 1px dashed #cfc4e8; border-radius: 6px; color: #5a4a79; font-size: 9px; }
    @media print { .print-hint { display: none; } tr { break-inside: avoid; } }
  </style>
</head>
<body>
  <main class="report">
    <header class="header">
      <div>
        <p class="topline">TestPulse Analytics / Test History</p>
        <h1>Test Comparison Report</h1>
        <p class="subtitle">Run-to-run changes across saved JUnit test reports</p>
      </div>
      <div class="generated">Generated<br><strong>${escapeHtml(generatedAt)}</strong></div>
    </header>

    <section class="run-grid">
      <div class="run-card">
        <span class="run-label">Baseline run</span>
        <strong>Run #${escapeHtml(comparison.baseline.id)}</strong>
        <span class="run-file">${escapeHtml(comparison.baseline.filename)}</span>
        <span class="run-date">Created: ${escapeHtml(formatDate(comparison.baseline.created_at))}</span>
      </div>
      <div class="run-card">
        <span class="run-label">Compared run</span>
        <strong>Run #${escapeHtml(comparison.compared.id)}</strong>
        <span class="run-file">${escapeHtml(comparison.compared.filename)}</span>
        <span class="run-date">Created: ${escapeHtml(formatDate(comparison.compared.created_at))}</span>
      </div>
    </section>

    <section>
      <div class="section-title">
        <h2>Comparison summary</h2>
        <span class="filter-meta">Filter: ${escapeHtml(filterLabel)} · Included rows: ${filteredCases.length} of ${comparison.cases.length}</span>
      </div>
      <div class="metrics">${summaryHtml}</div>
    </section>

    <section>
      <div class="section-title"><h2>Test case details</h2></div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr><th>Test name</th><th>Test class</th><th>Baseline status</th><th>Compared status</th><th>Change</th><th>Detail</th></tr>
          </thead>
          <tbody>${rowsHtml}</tbody>
        </table>
      </div>
      <p class="notes">Regressions are tests that were not failing in the baseline but fail or error in the compared run. Test matching uses class name and test name.</p>
    </section>

    <div class="footer">
      <span>TestPulse Analytics · Test history comparison</span>
      <span>Baseline Run #${escapeHtml(comparison.baseline.id)} → Compared Run #${escapeHtml(comparison.compared.id)}</span>
    </div>
    <p class="print-hint">To save this report as a PDF, choose <strong>Save as PDF</strong> in your browser's print dialog. For a clean report, keep landscape layout selected.</p>
  </main>
</body>
</html>`;

    reportWindow.document.open();
    reportWindow.document.write(reportHtml);
    reportWindow.document.close();
    reportWindow.focus();
    reportWindow.setTimeout(() => reportWindow.print(), 500);
    setExportNotice("PDF-ready report opened. Choose Save as PDF in the print dialog.");
  }

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
                className="comparison-results-toolbar"
                style={{
                  position: "relative",
                  zIndex: 50,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  flexWrap: "wrap",
                  gap: "10px",
                  marginBottom: "14px",
                }}
              >
                <div
                  className="range-switcher comparison-filter-controls"
                  role="group"
                  aria-label="Filter comparison results"
                  style={{
                    position: "relative",
                    zIndex: 50,
                    isolation: "isolate",
                    pointerEvents: "auto",
                    display: "flex",
                    flexWrap: "wrap",
                    gap: "3px",
                    marginBottom: 0,
                  }}
                >
                  {filterOptions.map((option) => (
                    <button
                      type="button"
                      key={option.key}
                      className={activeFilter === option.key ? "range-active" : ""}
                      aria-pressed={activeFilter === option.key}
                      title={`Show ${option.label.toLowerCase()} test cases`}
                      onPointerDown={() => {
                        setActiveFilter(option.key);
                        setExportNotice("");
                      }}
                      onMouseDown={() => setActiveFilter(option.key)}
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        setActiveFilter(option.key);
                        setExportNotice("");
                      }}
                      style={{
                        position: "relative",
                        zIndex: 51,
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        minHeight: "28px",
                        padding: "6px 9px",
                        cursor: "pointer",
                        pointerEvents: "auto",
                        touchAction: "manipulation",
                        userSelect: "none",
                      }}
                    >
                      {option.label}
                      <span style={{ marginLeft: "5px", opacity: 0.8 }}>{option.count}</span>
                    </button>
                  ))}
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                  <button
                    type="button"
                    className="insights-action comparison-export-button"
                    onClick={handleExportCsv}
                    disabled={!comparison || filteredCases.length === 0 || isComparing}
                    title="Download the currently displayed comparison rows as a CSV file"
                    style={{ minHeight: "32px", flexShrink: 0 }}
                  >
                    ↓ Export CSV ({filteredCases.length})
                  </button>
                  <button
                    type="button"
                    className="insights-action comparison-export-button"
                    onClick={handleExportPdf}
                    disabled={!comparison || filteredCases.length === 0 || isComparing}
                    title="Open a print-ready report that can be saved as PDF"
                    style={{ minHeight: "32px", flexShrink: 0 }}
                  >
                    ↓ Export PDF
                  </button>
                </div>
              </div>

              <p className="details-state comparison-filter-status" role="status" aria-live="polite">
                Showing {filteredCases.length} of {allCases.length} test cases
                {activeFilter !== "all" ? ` · Filter: ${filterOptions.find((option) => option.key === activeFilter)?.label ?? activeFilter}` : ""}
              </p>
              {exportNotice && (
                <p className="details-state" role="status" aria-live="polite">
                  {exportNotice}
                </p>
              )}

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
                            {changeDetail(item)}
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
