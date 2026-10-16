import { useCallback, useEffect, useMemo, useState } from "react";
import { getRunDetails } from "./api";
import type { RunDetails, TestCaseStatus, TestRun } from "./api";

type TestObservation = {
  runId: number;
  filename: string;
  createdAt: string;
  status: TestCaseStatus;
  message: string | null;
};

type FailureOccurrence = TestObservation & {
  status: "failed" | "error";
};

type FailureGroup = {
  key: string;
  name: string;
  className: string;
  occurrences: FailureOccurrence[];
  runIds: number[];
  latest: FailureOccurrence;
};

type FlakyTestGroup = {
  key: string;
  name: string;
  className: string;
  observations: TestObservation[];
  passedRunIds: number[];
  failedRunIds: number[];
  latest: TestObservation;
};

type FailureInsightsProps = {
  runs: TestRun[];
  isLoadingRuns: boolean;
  requested: boolean;
  onSelectRun?: (runId: number) => void;
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
  return error instanceof Error
    ? error.message
    : "Could not load failure insights for saved reports.";
}

export default function FailureInsights({
  runs,
  isLoadingRuns,
  requested,
  onSelectRun,
}: FailureInsightsProps) {
  const [detailsById, setDetailsById] = useState<Record<number, RunDetails>>({});
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [hasAnalyzed, setHasAnalyzed] = useState(false);
  const [error, setError] = useState("");

  const analyze = useCallback(async () => {
    if (isAnalyzing || isLoadingRuns) return;

    setIsAnalyzing(true);
    setHasAnalyzed(true);
    setError("");

    try {
      const details = await Promise.all(
        runs.map((run) => getRunDetails(run.id))
      );
      const detailsByRunId: Record<number, RunDetails> = {};
      for (const detail of details) {
        detailsByRunId[detail.id] = detail;
      }
      setDetailsById(detailsByRunId);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setIsAnalyzing(false);
    }
  }, [isAnalyzing, isLoadingRuns, runs]);

  useEffect(() => {
    if (requested && !hasAnalyzed && !isLoadingRuns) {
      void analyze();
    }
  }, [requested, hasAnalyzed, isLoadingRuns, analyze]);

  const allTestGroups = useMemo(() => {
    const groups = new Map<
      string,
      {
        key: string;
        name: string;
        className: string;
        observations: TestObservation[];
      }
    >();

    for (const run of runs) {
      const details = detailsById[run.id];
      if (!details) continue;

      for (const testCase of details.test_cases) {
        const className = testCase.class_name || "Unknown test class";
        const key = `${className.toLowerCase()}::${testCase.name.toLowerCase()}`;
        const group = groups.get(key) ?? {
          key,
          name: testCase.name,
          className,
          observations: [],
        };

        group.observations.push({
          runId: run.id,
          filename: run.filename,
          createdAt: run.created_at,
          status: testCase.status,
          message: testCase.message,
        });
        groups.set(key, group);
      }
    }

    return Array.from(groups.values()).map((group) => {
      const observations = [...group.observations].sort(
        (left, right) =>
          new Date(right.createdAt).getTime() -
          new Date(left.createdAt).getTime()
      );
      return { ...group, observations, latest: observations[0] };
    });
  }, [runs, detailsById]);

  const flakyGroups = useMemo<FlakyTestGroup[]>(() => {
    return allTestGroups
      .map((group) => {
        const passedRunIds = Array.from(
          new Set(
            group.observations
              .filter((item) => item.status === "passed")
              .map((item) => item.runId)
          )
        );
        const failedRunIds = Array.from(
          new Set(
            group.observations
              .filter((item) => item.status === "failed" || item.status === "error")
              .map((item) => item.runId)
          )
        );

        return {
          ...group,
          passedRunIds,
          failedRunIds,
        };
      })
      // A test is considered flaky only when it passes in one saved run and
      // fails/errors in a different saved run, not when states conflict only
      // within a single report.
      .filter((group) =>
        group.passedRunIds.some((passedId) =>
          group.failedRunIds.some((failedId) => failedId !== passedId)
        )
      )
      .sort(
        (left, right) =>
          right.failedRunIds.length + right.passedRunIds.length -
            (left.failedRunIds.length + left.passedRunIds.length) ||
          new Date(right.latest.createdAt).getTime() -
            new Date(left.latest.createdAt).getTime() ||
          left.name.localeCompare(right.name)
      );
  }, [allTestGroups]);

  const failureGroups = useMemo<FailureGroup[]>(() => {
    const groups = new Map<
      string,
      {
        key: string;
        name: string;
        className: string;
        occurrences: FailureOccurrence[];
      }
    >();

    for (const group of allTestGroups) {
      for (const observation of group.observations) {
        if (observation.status !== "failed" && observation.status !== "error") {
          continue;
        }

        const occurrence: FailureOccurrence = {
          ...observation,
          status: observation.status,
        };
        const existing = groups.get(group.key) ?? {
          key: group.key,
          name: group.name,
          className: group.className,
          occurrences: [],
        };
        existing.occurrences.push(occurrence);
        groups.set(group.key, existing);
      }
    }

    return Array.from(groups.values())
      .map((group) => {
        const occurrences = [...group.occurrences].sort(
          (left, right) =>
            new Date(right.createdAt).getTime() -
            new Date(left.createdAt).getTime()
        );
        const runIds = Array.from(new Set(occurrences.map((item) => item.runId)));
        return {
          ...group,
          occurrences,
          runIds,
          latest: occurrences[0],
        };
      })
      .sort(
        (left, right) =>
          right.runIds.length - left.runIds.length ||
          new Date(right.latest.createdAt).getTime() -
            new Date(left.latest.createdAt).getTime() ||
          left.name.localeCompare(right.name)
      );
  }, [allTestGroups]);

  const occurrenceCount = failureGroups.reduce(
    (count, group) => count + group.occurrences.length,
    0
  );
  const affectedRunCount = new Set(
    failureGroups.flatMap((group) => group.runIds)
  ).size;

  function renderRunChip(runId: number, label: string, statusClass?: string) {
    const className = `failure-run-chip${statusClass ? ` ${statusClass}` : ""}`;
    if (!onSelectRun) {
      return (
        <span className={className} key={`${runId}-${label}`}>
          {label}
        </span>
      );
    }

    return (
      <button
        type="button"
        className={`${className} failure-run-chip-button`}
        key={`${runId}-${label}`}
        onClick={() => onSelectRun(runId)}
        aria-label={`Open test details for run ${runId}`}
        style={{
          appearance: "none",
          cursor: "pointer",
          fontFamily: "inherit",
          lineHeight: "inherit",
          textAlign: "left",
        }}
      >
        {label}
      </button>
    );
  }

  return (
    <section className="panel failure-insights-panel" id="failures">
      <div className="panel-header failure-insights-header">
        <div>
          <h2>Failure insights</h2>
          <p>Recurring failing tests across your saved JUnit reports</p>
        </div>
        <button
          className="insights-action"
          type="button"
          onClick={() => void analyze()}
          disabled={isAnalyzing || isLoadingRuns}
        >
          {isAnalyzing
            ? "Analyzing…"
            : hasAnalyzed
              ? "↻ Refresh insights"
              : "Analyze reports"}
        </button>
      </div>

      {isAnalyzing && (
        <p className="details-state insights-loading" role="status">
          Analyzing test cases across {runs.length} saved report
          {runs.length === 1 ? "" : "s"}…
        </p>
      )}

      {error && !isAnalyzing && (
        <div className="details-error insights-error" role="alert">
          <span>{error}</span>
          <button type="button" onClick={() => void analyze()}>
            Retry
          </button>
        </div>
      )}

      {!hasAnalyzed && !isAnalyzing && (
        <div className="insights-empty">
          <strong>Find recurring failures and flaky tests</strong>
          <p>
            Analyze your saved reports to group repeated failures and detect
            tests that pass in one run but fail in another.
          </p>
        </div>
      )}

      {hasAnalyzed && !isAnalyzing && !error && (
        <>
          {runs.length === 0 ? (
            <div className="insights-empty">
              <strong>No saved reports to analyze</strong>
              <p>Import a JUnit XML report and run the analysis again.</p>
            </div>
          ) : (
            <>
              <div className="failure-insights-summary">
                <div>
                  <span>Unique failing tests</span>
                  <strong>{failureGroups.length.toLocaleString()}</strong>
                </div>
                <div>
                  <span>Affected reports</span>
                  <strong>{affectedRunCount.toLocaleString()}</strong>
                </div>
                <div>
                  <span>Failure occurrences</span>
                  <strong>{occurrenceCount.toLocaleString()}</strong>
                </div>
              </div>

              <section className="flaky-tests-section" aria-labelledby="flaky-tests-heading">
                <div className="flaky-tests-header">
                  <div>
                    <h3 id="flaky-tests-heading">Flaky test detection</h3>
                    <p>Tests that passed in one report and failed in another</p>
                  </div>
                  <span className="flaky-count">
                    {flakyGroups.length} detected
                  </span>
                </div>

                {flakyGroups.length === 0 ? (
                  <div className="insights-empty flaky-empty">
                    <strong>No flaky tests detected</strong>
                    <p>
                      No test has both a passing result and a failed or errored
                      result across different saved reports. Refresh insights
                      after importing new runs to check again.
                    </p>
                  </div>
                ) : (
                  <div className="flaky-test-list">
                    {flakyGroups.map((group) => {
                      const runIds = Array.from(
                        new Set([...group.passedRunIds, ...group.failedRunIds])
                      );
                      const runsToShow = runIds.slice(0, 4);

                      return (
                        <article className="flaky-test-card" key={group.key}>
                          <div className="flaky-test-top">
                            <div className="flaky-test-identity">
                              <span className="flaky-status-badge">Flaky</span>
                              <div>
                                <strong>{group.name}</strong>
                                <small>{group.className}</small>
                              </div>
                            </div>
                            <span className="flaky-outcome-count">
                              {group.passedRunIds.length} passed · {group.failedRunIds.length} failed
                            </span>
                          </div>

                          <p className="flaky-test-message">
                            {group.latest.message ||
                              "This test has inconsistent results across saved runs."}
                          </p>

                          <div className="flaky-run-list">
                            <strong>Run history:</strong>
                            {runsToShow.map((runId) => {
                              const observation = group.observations.find(
                                (item) => item.runId === runId
                              );
                              if (!observation) return null;

                              return renderRunChip(
                                runId,
                                `Run #${runId} · ${observation.status} · ${formatDate(observation.createdAt)}`,
                                observation.status === "passed"
                                  ? "flaky-run-passed"
                                  : observation.status === "failed" || observation.status === "error"
                                    ? "flaky-run-failed"
                                    : "flaky-run-other"
                              );
                            })}
                            {runIds.length > 4 && (
                              <span className="failure-run-chip">
                                +{runIds.length - 4} more
                              </span>
                            )}
                          </div>
                        </article>
                      );
                    })}
                  </div>
                )}
              </section>

              <div className="failure-list-heading">
                <h3>Recurring failures</h3>
                <p>Failures grouped by test class and name</p>
              </div>

              {failureGroups.length === 0 ? (
                <div className="insights-empty insights-clear">
                  <strong>No failures found in the loaded reports</strong>
                  <p>
                    The saved report details contain no failed or errored test
                    cases.
                  </p>
                </div>
              ) : (
                <div className="failure-insight-list">
                  {failureGroups.map((group) => (
                    <article className="failure-insight-card" key={group.key}>
                      <div className="failure-insight-top">
                        <div className="failure-insight-identity">
                          <span className={`case-status ${group.latest.status}`}>
                            {group.latest.status}
                          </span>
                          <div>
                            <strong>{group.name}</strong>
                            <small>{group.className}</small>
                          </div>
                        </div>
                        <span className="failure-occurrence-count">
                          {group.occurrences.length} occurrence
                          {group.occurrences.length === 1 ? "" : "s"}
                        </span>
                      </div>

                      <p className="failure-insight-message">
                        {group.latest.message ||
                          "No failure message was provided by the report."}
                      </p>

                      <div className="failure-run-list">
                        <strong>Seen in:</strong>
                        {group.runIds.slice(0, 4).map((runId) => {
                          const occurrence = group.occurrences.find(
                            (item) => item.runId === runId
                          );
                          if (!occurrence) return null;
                          return renderRunChip(
                            runId,
                            `Run #${runId} · ${formatDate(occurrence.createdAt)}`
                          );
                        })}
                        {group.runIds.length > 4 && (
                          <span className="failure-run-chip">
                            +{group.runIds.length - 4} more
                          </span>
                        )}
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </>
          )}
        </>
      )}
    </section>
  );
}
