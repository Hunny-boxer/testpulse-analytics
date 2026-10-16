import { useCallback, useEffect, useMemo, useState } from "react";
import { getRunDetails } from "./api";
import type { RunDetails, TestRun } from "./api";

type FailureOccurrence = {
  runId: number;
  filename: string;
  createdAt: string;
  status: "failed" | "error";
  message: string | null;
};

type FailureGroup = {
  key: string;
  name: string;
  className: string;
  occurrences: FailureOccurrence[];
  runIds: number[];
  latest: FailureOccurrence;
};

type FailureInsightsProps = {
  runs: TestRun[];
  isLoadingRuns: boolean;
  requested: boolean;
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

    for (const run of runs) {
      const details = detailsById[run.id];
      if (!details) continue;

      for (const testCase of details.test_cases) {
        if (testCase.status !== "failed" && testCase.status !== "error") {
          continue;
        }

        const className = testCase.class_name || "Unknown test class";
        const key = `${className.toLowerCase()}::${testCase.name.toLowerCase()}`;
        const group = groups.get(key) ?? {
          key,
          name: testCase.name,
          className,
          occurrences: [],
        };

        group.occurrences.push({
          runId: run.id,
          filename: run.filename,
          createdAt: run.created_at,
          status: testCase.status,
          message: testCase.message,
        });
        groups.set(key, group);
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
  }, [runs, detailsById]);

  const occurrenceCount = failureGroups.reduce(
    (count, group) => count + group.occurrences.length,
    0
  );
  const affectedRunCount = new Set(
    failureGroups.flatMap((group) => group.runIds)
  ).size;

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
          <strong>Find recurring failures</strong>
          <p>
            Open Failure insights to analyze saved reports, group repeated test
            failures, and review their latest error messages.
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

                          return (
                            <span className="failure-run-chip" key={runId}>
                              Run #{runId} · {formatDate(occurrence.createdAt)}
                            </span>
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
