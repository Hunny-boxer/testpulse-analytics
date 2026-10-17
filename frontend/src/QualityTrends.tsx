import "./QualityTrends.css";
import { useEffect, useMemo, useState } from "react";
import { getRunDetails } from "./api";
import type { RunDetails, TestCaseDetails, TestRun } from "./api";

type LoadedRun = {
  run: TestRun;
  details: RunDetails | null;
};

type QualityPoint = {
  run: TestRun;
  passRate: number | null;
  failureRate: number | null;
  regressions: number | null;
  fixes: number | null;
};

type FlakyTest = {
  key: string;
  name: string;
  className: string;
  observations: number;
  transitions: number;
};

type TestObservation = {
  run: TestRun;
  testCase: TestCaseDetails;
};

const HISTORY_LIMIT = 20;

function getTestKey(testCase: TestCaseDetails): string {
  return `${testCase.class_name || testCase.suite}::${testCase.name}`;
}

function isFailure(status: string | undefined): boolean {
  return status === "failed" || status === "error";
}

function getPassRate(run: TestRun): number | null {
  const { passed, failures, errors } = run.summary;
  const completed = passed + failures + errors;
  return completed > 0 ? (passed / completed) * 100 : null;
}

function getFailureRate(run: TestRun): number | null {
  const { passed, failures, errors } = run.summary;
  const completed = passed + failures + errors;
  return completed > 0 ? ((failures + errors) / completed) * 100 : null;
}

function formatRate(value: number | null): string {
  return value === null ? "—" : `${value.toFixed(1)}%`;
}

function formatRunDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Date unavailable";

  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatTestDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "—";
  if (seconds < 1) return `${Math.round(seconds * 1000)} ms`;
  if (seconds < 60) return `${seconds.toFixed(2)} s`;
  const minutes = Math.floor(seconds / 60);
  const remaining = Math.round(seconds % 60);
  return `${minutes}m ${remaining.toString().padStart(2, "0")}s`;
}

function formatDelta(value: number | null): string {
  if (value === null) return "Compared with previous run: —";
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  return `${sign}${Math.abs(value).toFixed(1)} percentage points vs previous run`;
}


function buildRatePath(points: QualityPoint[], key: "passRate" | "failureRate"): string {
  if (points.length === 0) return "";
  const drawable = points.filter((point) => point[key] !== null);
  if (drawable.length === 0) return "";

  return drawable.map((point, index) => {
    const originalIndex = points.indexOf(point);
    const x = points.length === 1 ? 380 : 24 + (originalIndex * 712) / (points.length - 1);
    const y = 124 - ((point[key] ?? 0) / 100) * 108;
    return `${index === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
  }).join(" ");
}

function buildRateDots(points: QualityPoint[], key: "passRate" | "failureRate") {
  return points.flatMap((point, index) => {
    const value = point[key];
    if (value === null) return [];
    const x = points.length === 1 ? 380 : 24 + (index * 712) / (points.length - 1);
    const y = 124 - (value / 100) * 108;
    return [{ x, y, runId: point.run.id, value }];
  });
}

function countRunChanges(
  previous: RunDetails,
  current: RunDetails
): { regressions: number; fixes: number } {
  const previousByKey = new Map(
    previous.test_cases.map((testCase) => [getTestKey(testCase), testCase])
  );
  let regressions = 0;
  let fixes = 0;

  for (const testCase of current.test_cases) {
    const before = previousByKey.get(getTestKey(testCase));
    if (!before) continue;

    if (before.status === "passed" && isFailure(testCase.status)) regressions += 1;
    if (isFailure(before.status) && testCase.status === "passed") fixes += 1;
  }

  return { regressions, fixes };
}

function selectedTestFlakyCount(testCase: FlakyTest): number {
  return testCase.transitions;
}

function findFlakyTests(history: LoadedRun[]): FlakyTest[] {
  const outcomes = new Map<string, {
    name: string;
    className: string;
    statuses: string[];
  }>();

  for (const entry of history) {
    if (!entry.details) continue;
    for (const testCase of entry.details.test_cases) {
      const key = getTestKey(testCase);
      const current = outcomes.get(key) ?? {
        name: testCase.name,
        className: testCase.class_name || testCase.suite,
        statuses: [],
      };
      current.statuses.push(testCase.status);
      outcomes.set(key, current);
    }
  }

  const flaky: FlakyTest[] = [];
  for (const [key, item] of outcomes) {
    const decisiveOutcomes = item.statuses.filter(
      (status) => status === "passed" || isFailure(status)
    );
    const hasPass = decisiveOutcomes.includes("passed");
    const hasFailure = decisiveOutcomes.some((status) => isFailure(status));

    // Flag only repeated tests with at least three observations and both pass/fail outcomes.
    if (decisiveOutcomes.length < 3 || !hasPass || !hasFailure) continue;

    let transitions = 0;
    for (let index = 1; index < decisiveOutcomes.length; index += 1) {
      const previousFailed = isFailure(decisiveOutcomes[index - 1]);
      const currentFailed = isFailure(decisiveOutcomes[index]);
      if (previousFailed !== currentFailed) transitions += 1;
    }

    flaky.push({
      key,
      name: item.name,
      className: item.className,
      observations: decisiveOutcomes.length,
      transitions,
    });
  }

  return flaky.sort((a, b) => b.transitions - a.transitions || b.observations - a.observations);
}

export default function QualityTrends({
  runs,
  onSelectRun,
}: {
  runs: TestRun[];
  onSelectRun: (runId: number) => void;
}) {
  const [history, setHistory] = useState<LoadedRun[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedTestKey, setSelectedTestKey] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadHistory() {
      const chronological = [...runs]
        .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
        .slice(-HISTORY_LIMIT);

      if (chronological.length === 0) {
        setHistory([]);
        setIsLoading(false);
        return;
      }

      setIsLoading(true);
      const loaded = new Array<LoadedRun>(chronological.length);
      let nextIndex = 0;

      // Keep API traffic bounded instead of requesting every report at once.
      async function worker() {
        while (true) {
          const index = nextIndex;
          nextIndex += 1;
          if (index >= chronological.length) return;

          const run = chronological[index];
          try {
            loaded[index] = { run, details: await getRunDetails(run.id) };
          } catch {
            loaded[index] = { run, details: null };
          }
        }
      }

      await Promise.all(
        Array.from({ length: Math.min(4, chronological.length) }, () => worker())
      );

      if (!cancelled) {
        setHistory(loaded);
        setIsLoading(false);
      }
    }

    void loadHistory();
    return () => {
      cancelled = true;
    };
  }, [runs]);

  const qualityPoints = useMemo<QualityPoint[]>(() => {
    return history.map((entry, index) => {
      let regressions: number | null = null;
      let fixes: number | null = null;
      const previous = history[index - 1];

      if (previous?.details && entry.details) {
        const changes = countRunChanges(previous.details, entry.details);
        regressions = changes.regressions;
        fixes = changes.fixes;
      }

      return {
        run: entry.run,
        passRate: getPassRate(entry.run),
        failureRate: getFailureRate(entry.run),
        regressions,
        fixes,
      };
    });
  }, [history]);

  const flakyTests = useMemo(() => findFlakyTests(history), [history]);
  const selectedFlakyTest = flakyTests.find((testCase) => testCase.key === selectedTestKey) ?? null;
  const selectedTestHistory = useMemo<TestObservation[]>(() => {
    if (!selectedTestKey) return [];

    return history.flatMap((entry) => {
      const matchingTest = entry.details?.test_cases.find(
        (testCase) => getTestKey(testCase) === selectedTestKey
      );

      return matchingTest ? [{ run: entry.run, testCase: matchingTest }] : [];
    }).reverse();
  }, [history, selectedTestKey]);
  const selectedTestFailureCount = selectedTestHistory.filter(
    (observation) => isFailure(observation.testCase.status)
  ).length;
  const successfulDetailCount = history.filter((entry) => entry.details !== null).length;
  const latest = qualityPoints[qualityPoints.length - 1];
  const previous = qualityPoints[qualityPoints.length - 2];
  const passDelta = latest?.passRate !== null && latest?.passRate !== undefined && previous?.passRate !== null && previous?.passRate !== undefined
    ? latest.passRate - previous.passRate
    : null;
  const failureDelta = latest?.failureRate !== null && latest?.failureRate !== undefined && previous?.failureRate !== null && previous?.failureRate !== undefined
    ? latest.failureRate - previous.failureRate
    : null;
  const chartPoints = qualityPoints;
  const recentRegressionPoints = qualityPoints.slice(-12);
  const maxChangeCount = Math.max(
    1,
    ...recentRegressionPoints.flatMap((point) => [point.regressions ?? 0, point.fixes ?? 0])
  );
  const passDots = buildRateDots(chartPoints, "passRate");
  const failureDots = buildRateDots(chartPoints, "failureRate");

  return (
    <section className="quality-trends-section" id="quality-trends" aria-labelledby="quality-trends-title">
      <div className="quality-trends-heading">
        <div>
          <div className="quality-trends-eyebrow"><span /> QUALITY INTELLIGENCE</div>
          <h2 id="quality-trends-title">Test quality trends</h2>
          <p>Track reliability across your latest {HISTORY_LIMIT} saved runs.</p>
        </div>
        <span className="quality-trends-window">{history.length} runs in window</span>
      </div>

      <div className="quality-trends-metrics">
        <article className="quality-trend-metric pass-metric">
          <div className="quality-trend-metric-top"><span>Latest pass rate</span><span className="quality-trend-icon">↗</span></div>
          <strong>{formatRate(latest?.passRate ?? null)}</strong>
          <small className={passDelta === null ? "" : passDelta >= 0 ? "trend-positive" : "trend-negative"}>
            {formatDelta(passDelta)}
          </small>
        </article>
        <article className="quality-trend-metric fail-metric">
          <div className="quality-trend-metric-top"><span>Latest failure rate</span><span className="quality-trend-icon">!</span></div>
          <strong>{formatRate(latest?.failureRate ?? null)}</strong>
          <small className={failureDelta === null ? "" : failureDelta <= 0 ? "trend-positive" : "trend-negative"}>
            {formatDelta(failureDelta)}
          </small>
        </article>
        <article className="quality-trend-metric flaky-metric">
          <div className="quality-trend-metric-top"><span>Potentially flaky tests</span><span className="quality-trend-icon">≈</span></div>
          <strong>{isLoading ? "…" : flakyTests.length}</strong>
          <small>Mixed pass/fail across 3+ observations</small>
        </article>
        <article className="quality-trend-metric regression-metric">
          <div className="quality-trend-metric-top"><span>Latest regressions</span><span className="quality-trend-icon">⌁</span></div>
          <strong>{isLoading || latest?.regressions === null || latest?.regressions === undefined ? "—" : latest.regressions}</strong>
          <small>
            {latest?.fixes === null || latest?.fixes === undefined
              ? "Needs details for two adjacent runs"
              : `${latest.fixes} fix${latest.fixes === 1 ? "" : "es"} in the latest run`}
          </small>
        </article>
      </div>

      <div className="quality-trends-charts">
        <article className="panel quality-trend-chart-panel">
          <div className="quality-trend-panel-heading">
            <div><h3>Pass vs. failure rate</h3><p>Completed tests per run, excluding skipped tests</p></div>
            <span className="quality-trend-count">{chartPoints.length} data points</span>
          </div>
          {chartPoints.length === 0 ? (
            <div className="quality-trend-empty">Import JUnit reports to start building a quality history.</div>
          ) : (
            <>
              <div className="quality-rate-legend">
                <span><i className="quality-pass-dot" /> Pass rate</span>
                <span><i className="quality-fail-dot" /> Failure rate</span>
              </div>
              <div className="quality-rate-chart-wrap">
                <div className="quality-rate-y-axis"><span>100%</span><span>75%</span><span>50%</span><span>25%</span><span>0%</span></div>
                <svg className="quality-rate-chart" viewBox="0 0 760 140" preserveAspectRatio="none" role="img" aria-label="Pass and failure rates over the latest runs">
                  {[16, 43, 70, 97, 124].map((y) => <line key={y} x1="24" y1={y} x2="736" y2={y} className="quality-chart-gridline" />)}
                  <path d={buildRatePath(chartPoints, "passRate")} className="quality-pass-line" />
                  <path d={buildRatePath(chartPoints, "failureRate")} className="quality-fail-line" />
                  {passDots.map((dot) => <circle key={`pass-${dot.runId}`} cx={dot.x} cy={dot.y} r="3.1" className="quality-pass-point"><title>{`Run #${dot.runId}: pass rate ${dot.value.toFixed(1)}%`}</title></circle>)}
                  {failureDots.map((dot) => <circle key={`fail-${dot.runId}`} cx={dot.x} cy={dot.y} r="2.8" className="quality-fail-point"><title>{`Run #${dot.runId}: failure rate ${dot.value.toFixed(1)}%`}</title></circle>)}
                </svg>
              </div>
              <div className="quality-rate-x-axis">
                {chartPoints.map((point, index) => (
                  <span key={point.run.id} className={index === chartPoints.length - 1 || index === 0 || index % Math.max(1, Math.ceil(chartPoints.length / 6)) === 0 ? "" : "quality-x-label-hidden"}>
                    #{point.run.id}
                  </span>
                ))}
              </div>
            </>
          )}
        </article>

        <article className="panel quality-trend-chart-panel">
          <div className="quality-trend-panel-heading">
            <div><h3>Regressions &amp; fixes</h3><p>Compared with the immediately previous run</p></div>
            <span className="quality-trend-count">Last {recentRegressionPoints.length} runs</span>
          </div>
          {recentRegressionPoints.length < 2 || !recentRegressionPoints.some((point) => point.regressions !== null) ? (
            <div className="quality-trend-empty">Load details for at least two adjacent runs to build this trend.</div>
          ) : (
            <>
              <div className="quality-rate-legend">
                <span><i className="quality-regression-dot" /> Regressions</span>
                <span><i className="quality-fix-dot" /> Fixes</span>
              </div>
              <div className="quality-regression-chart" role="img" aria-label="Regressions and fixes per run">
                {recentRegressionPoints.map((point) => (
                  <div className="quality-regression-run" key={point.run.id} title={`Run #${point.run.id}: ${point.regressions === null ? "comparison unavailable" : `${point.regressions} regressions, ${point.fixes ?? 0} fixes`}`}>
                    <div className="quality-regression-bar-pair">
                      <span className={`quality-regression-bar ${point.regressions === null ? "unavailable" : ""}`} style={{ height: `${point.regressions === null ? 3 : Math.max(point.regressions > 0 ? 7 : 3, (point.regressions / maxChangeCount) * 84)}px` }} />
                      <span className={`quality-fix-bar ${point.fixes === null ? "unavailable" : ""}`} style={{ height: `${point.fixes === null ? 3 : Math.max(point.fixes > 0 ? 7 : 3, (point.fixes / maxChangeCount) * 84)}px` }} />
                    </div>
                    <small>#{point.run.id}</small>
                  </div>
                ))}
              </div>
              <p className="quality-chart-footnote">A regression is a previously passing test that now fails or errors. A fix is a previously failing/error test that now passes.</p>
            </>
          )}
        </article>
      </div>

      <article className="panel quality-flaky-panel">
        <div className="quality-trend-panel-heading">
          <div><h3>Potentially flaky tests</h3><p>Tests that alternate between pass and fail/error across repeated runs</p></div>
          <span className="quality-trend-count">{isLoading ? "Analyzing…" : `${flakyTests.length} flagged`}</span>
        </div>
        {isLoading ? (
          <div className="quality-trend-empty">Analyzing test details across recent runs…</div>
        ) : flakyTests.length === 0 ? (
          <div className="quality-trend-empty quality-trend-empty-success">
            <span>✓</span><div><strong>No potentially flaky tests detected</strong><p>We flag a test when it has at least three pass/fail observations and has both passed and failed (or errored) in this history window.</p></div>
          </div>
        ) : (
          <div className="quality-flaky-list">
            {flakyTests.slice(0, 8).map((testCase) => {
              const isSelected = selectedTestKey === testCase.key;
              return (
                <button
                  type="button"
                  className={`quality-flaky-row quality-flaky-row-button ${isSelected ? "selected" : ""}`}
                  key={testCase.key}
                  aria-expanded={isSelected}
                  aria-controls="quality-flaky-drilldown"
                  onClick={() => setSelectedTestKey((current) => current === testCase.key ? null : testCase.key)}
                  title="View this test's run-by-run history"
                >
                  <span className="quality-flaky-mark">≈</span>
                  <span className="quality-flaky-name"><strong>{testCase.name}</strong><small>{testCase.className}</small></span>
                  <span className="quality-flaky-observations">{testCase.observations} observations</span>
                  <span className="quality-flaky-transitions">{testCase.transitions} changes <span aria-hidden="true">{isSelected ? "⌃" : "›"}</span></span>
                </button>
              );
            })}
            {flakyTests.length > 8 && <p className="quality-chart-footnote">Showing 8 of {flakyTests.length} potentially flaky tests.</p>}
          </div>
        )}

        {selectedFlakyTest && (
          <section className="quality-flaky-drilldown" id="quality-flaky-drilldown" aria-labelledby="quality-flaky-drilldown-title">
            <div className="quality-flaky-drilldown-heading">
              <div>
                <span className="quality-drilldown-eyebrow">TEST HISTORY</span>
                <h4 id="quality-flaky-drilldown-title">{selectedFlakyTest.name}</h4>
                <p>{selectedFlakyTest.className}</p>
              </div>
              <button type="button" className="quality-drilldown-close" onClick={() => setSelectedTestKey(null)}>
                Close history <span aria-hidden="true">×</span>
              </button>
            </div>

            <div className="quality-flaky-drilldown-stats">
              <div><strong>{selectedTestHistory.length}</strong><span>Recorded runs</span></div>
              <div><strong>{selectedTestFlakyCount(selectedFlakyTest)}</strong><span>Pass/fail changes</span></div>
              <div><strong>{selectedTestFailureCount}</strong><span>Failures/errors</span></div>
            </div>

            {selectedTestHistory.length === 0 ? (
              <div className="quality-trend-empty">No test-level outcomes were found for this test in the loaded history.</div>
            ) : (
              <div className="quality-test-history-list">
                {selectedTestHistory.map(({ run, testCase }) => (
                  <article className="quality-test-history-row" key={`${run.id}-${getTestKey(testCase)}`}>
                    <div className="quality-test-history-run">
                      <span className={`quality-history-status ${testCase.status}`}>{testCase.status}</span>
                      <div className="quality-test-history-run-copy">
                        <strong>Run #{run.id}</strong>
                        <small>{run.filename}</small>
                        <small>{formatRunDate(run.created_at)}</small>
                        <button
                          type="button"
                          className="quality-open-run-button"
                          onClick={() => onSelectRun(run.id)}
                          aria-label={`Open run ${run.id} in Recent Test Runs`}
                          title="Open this run in Recent Test Runs"
                        >
                          Open run details <span aria-hidden="true">↗</span>
                        </button>
                      </div>
                    </div>
                    <div className="quality-test-history-duration">
                      <span>Duration</span>
                      <strong>{formatTestDuration(testCase.duration_seconds)}</strong>
                    </div>
                    {isFailure(testCase.status) && (
                      <div className="quality-test-history-message">
                        <strong>Failure message</strong>
                        <p>{testCase.message?.trim() || "No failure message was recorded for this result."}</p>
                      </div>
                    )}
                  </article>
                ))}
              </div>
            )}
            <p className="quality-chart-footnote">Run history is listed newest first. Failure messages appear when the JUnit report included one.</p>
          </section>
        )}

        {!isLoading && successfulDetailCount < history.length && history.length > 0 && (
          <p className="quality-trend-warning" role="status">
            Test details loaded for {successfulDetailCount} of {history.length} runs. Flaky and regression counts may be incomplete until all run details are available.
          </p>
        )}
      </article>
    </section>
  );
}
