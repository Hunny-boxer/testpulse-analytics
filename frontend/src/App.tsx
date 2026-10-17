import { Fragment, useEffect, useMemo, useState } from "react";
import { getRunDetails, getRuns, uploadReport } from "./api";
import FailureInsights from "./FailureInsights";
import QualityTrends from "./QualityTrends";
import RunComparison from "./RunComparison";
import type { RunDetails, TestRun } from "./api";

type ChartPoint = {
  label: string;
  passedRate: number;
  failedRate: number;
};

type RunDetailsError = {
  runId: number;
  message: string;
};

function getErrorMessage(error: unknown): string {
  if (error instanceof TypeError) {
    return "Could not reach the API. Check the deployed API URL and CORS settings.";
  }

  return error instanceof Error ? error.message : "An unexpected error occurred.";
}

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "—";
  if (seconds < 60) return `${seconds.toFixed(1)}s`;

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.round(seconds % 60);

  return `${minutes}m ${remainingSeconds.toString().padStart(2, "0")}s`;
}

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

function App() {
  const [runs, setRuns] = useState<TestRun[]>([]);
  const [query, setQuery] = useState("");
  const [selectedRange, setSelectedRange] = useState("7 days");
  const [isLoading, setIsLoading] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [activeNav, setActiveNav] = useState("overview");
  const [insightsRequested, setInsightsRequested] = useState(false);
  const [expandedRunId, setExpandedRunId] = useState<number | null>(null);
  const [runDetailsById, setRunDetailsById] = useState<Record<number, RunDetails>>({});
  const [loadingRunId, setLoadingRunId] = useState<number | null>(null);
  const [runDetailsError, setRunDetailsError] = useState<RunDetailsError | null>(null);

  async function refreshRuns() {
    setIsLoading(true);
    setError("");

    try {
      const response = await getRuns();
      setRuns(response.runs);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setIsLoading(false);
    }
  }

  async function loadRunDetails(runId: number) {
    setExpandedRunId(runId);
    setRunDetailsError(null);

    if (runDetailsById[runId]) return;

    setLoadingRunId(runId);

    try {
      const details = await getRunDetails(runId);
      setRunDetailsById((current) => ({ ...current, [runId]: details }));
    } catch (err) {
      setRunDetailsError({
        runId,
        message: err instanceof Error ? err.message : "Could not load test run details.",
      });
    } finally {
      setLoadingRunId((current) => (current === runId ? null : current));
    }
  }

  function toggleRunDetails(runId: number) {
    if (expandedRunId === runId) {
      setExpandedRunId(null);
      setRunDetailsError(null);
      return;
    }

    void loadRunDetails(runId);
  }

  function handleSelectFailureRun(runId: number) {
    setQuery("");
    setActiveNav("recent-runs");
    void loadRunDetails(runId);

    document.getElementById("recent-runs")?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  }

  useEffect(() => {
    void refreshRuns();
  }, []);

  // Keep the active sidebar item synchronized with the section being viewed.
  useEffect(() => {
    const navigationTargets = [
      { id: "recent-runs", navigation: "recent-runs" },
      { id: "quality-trends", navigation: "quality-trends" },
      { id: "run-comparison", navigation: "comparison" },
      { id: "failures", navigation: "failures" },
    ] as const;

    const syncActiveNavigation = () => {
      const activationLine = 180;
      let nextActiveNavigation: string = "overview";

      for (const target of navigationTargets) {
        const section = document.getElementById(target.id);

        if (section && section.getBoundingClientRect().top <= activationLine) {
          nextActiveNavigation = target.navigation;
        }
      }

      setActiveNav((current) =>
        current === nextActiveNavigation ? current : nextActiveNavigation
      );
    };

    syncActiveNavigation();

    window.addEventListener("scroll", syncActiveNavigation, { passive: true });
    window.addEventListener("resize", syncActiveNavigation);

    return () => {
      window.removeEventListener("scroll", syncActiveNavigation);
      window.removeEventListener("resize", syncActiveNavigation);
    };
  }, []);

  const totals = useMemo(() => {
    return runs.reduce(
      (acc, run) => {
        acc.passed += run.summary.passed;
        acc.failed += run.summary.failures;
        acc.errors += run.summary.errors;
        acc.skipped += run.summary.skipped;
        acc.tests += run.summary.total_tests;
        acc.duration += run.summary.duration_seconds;
        acc.suites += run.summary.suite_count;
        return acc;
      },
      {
        passed: 0,
        failed: 0,
        errors: 0,
        skipped: 0,
        tests: 0,
        duration: 0,
        suites: 0,
      }
    );
  }, [runs]);

  const totalFailed = totals.failed + totals.errors;
  const completedTests = totals.passed + totalFailed;
  const passRate =
    completedTests > 0 ? (totals.passed / completedTests) * 100 : null;
  const averageDuration =
    runs.length > 0 ? totals.duration / runs.length : null;

  const visibleRuns = useMemo(() => {
    const normalized = query.trim().toLowerCase();

    return runs.filter((run) =>
      `${run.id} ${run.filename} ${formatDate(run.created_at)}`
        .toLowerCase()
        .includes(normalized)
    );
  }, [runs, query]);

  const chartPoints = useMemo<ChartPoint[]>(() => {
    const days = selectedRange === "7 days" ? 7 : 30;
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;

    return runs
      .filter((run) => {
        const timestamp = new Date(run.created_at).getTime();
        return Number.isFinite(timestamp) && timestamp >= cutoff;
      })
      .slice(0, 7)
      .reverse()
      .map((run) => {
        const summary = run.summary;
        const finished =
          summary.passed + summary.failures + summary.errors;

        return {
          label: new Date(run.created_at).toLocaleDateString(undefined, {
            month: "short",
            day: "numeric",
          }),
          passedRate: finished > 0 ? (summary.passed / finished) * 100 : 0,
          failedRate:
            finished > 0
              ? ((summary.failures + summary.errors) / finished) * 100
              : 0,
        };
      });
  }, [runs, selectedRange]);

  function chartPath(
    points: ChartPoint[],
    key: "passedRate" | "failedRate"
  ): string {
    if (points.length === 0) return "";

    return points
      .map((point, index) => {
        const x = points.length === 1 ? 350 : (index * 700) / (points.length - 1);
        const y = 205 - (point[key] / 100) * 180;
        return `${index === 0 ? "M" : "L"}${x} ${y}`;
      })
      .join(" ");
  }

  function chartAreaPath(points: ChartPoint[]): string {
    if (points.length === 0) return "";

    const line = chartPath(points, "passedRate");
    const lastX = points.length === 1 ? 350 : 700;

    return `${line} L${lastX} 205 L${points.length === 1 ? 350 : 0} 205 Z`;
  }

  async function handleFileSelection(
    event: React.ChangeEvent<HTMLInputElement>
  ) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";

    if (!file) return;

    setError("");
    setNotice("");

    if (!file.name.toLowerCase().endsWith(".xml")) {
      setError("Please select a JUnit report with an .xml filename.");
      return;
    }

    setIsUploading(true);

    try {
      const uploaded = await uploadReport(file);
      setNotice(
        `Imported ${uploaded.filename}: ${uploaded.summary.total_tests} tests saved as run #${uploaded.run_id}.`
      );
      await refreshRuns();
      setExpandedRunId(uploaded.run_id);
      setRunDetailsById((current) => {
        const next = { ...current };
        delete next[uploaded.run_id];
        return next;
      });
      await loadRunDetails(uploaded.run_id);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setIsUploading(false);
    }
  }

  const donutTotal = totals.passed + totalFailed + totals.skipped;
  const donutPassedDegrees =
    donutTotal > 0 ? (totals.passed / donutTotal) * 360 : 0;
  const donutFailedDegrees =
    donutTotal > 0 ? (totalFailed / donutTotal) * 360 : 0;

  const donutBackground =
    donutTotal > 0
      ? `conic-gradient(#a78bfa 0deg ${donutPassedDegrees}deg, #fb7185 ${donutPassedDegrees}deg ${donutPassedDegrees + donutFailedDegrees}deg, #6286a8 ${donutPassedDegrees + donutFailedDegrees}deg 360deg)`
      : "#2a2139";

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#overview" aria-label="TestPulse home">
          <span className="brand-mark">T</span>
          <span className="brand-name">
            Test<span>Pulse</span>
          </span>
        </a>

        <div className="workspace-label">WORKSPACE</div>
        <div className="workspace-switcher">
          <span className="workspace-avatar">T</span>
          <span className="workspace-copy">
            <strong>TestPulse workspace</strong>
            <small>Local environment</small>
          </span>
          <span className="chevron">⌄</span>
        </div>

        <nav className="side-nav" aria-label="Main navigation">
          <p className="nav-label">ANALYTICS</p>

          <a
            className={`nav-item ${activeNav === "overview" ? "active" : ""}`}
            href="#overview"
            onClick={() => setActiveNav("overview")}
          >
            <span className="nav-icon">◫</span>
            Overview
            <span className="nav-indicator" />
          </a>

          <a
            className={`nav-item ${activeNav === "recent-runs" ? "active" : ""}`}
            href="#recent-runs"
            onClick={() => setActiveNav("recent-runs")}
          >
            <span className="nav-icon">◷</span>
            Test runs
          </a>

          <a
            className={`nav-item ${activeNav === "quality-trends" ? "active" : ""}`}
            href="#quality-trends"
            onClick={() => setActiveNav("quality-trends")}
          >
            <span className="nav-icon">⌁</span>
            Quality trends
          </a>

          <a
            className={`nav-item ${activeNav === "comparison" ? "active" : ""}`}
            href="#run-comparison"
            onClick={() => setActiveNav("comparison")}
          >
            <span className="nav-icon">⇄</span>
            Compare runs
          </a>

          <a
            className={`nav-item ${activeNav === "failures" ? "active" : ""}`}
            href="#failures"
            onClick={() => {
              setActiveNav("failures");
              setInsightsRequested(true);
            }}
          >
            <span className="nav-icon">⊗</span>
            Failure insights
          </a>

          <p className="nav-label nav-label-spaced">MANAGE</p>

          <a
            className={`nav-item ${activeNav === "reports" ? "active" : ""}`}
            href="#reports"
            onClick={() => setActiveNav("reports")}
          >
            <span className="nav-icon">⇧</span>
            Import reports
          </a>
        </nav>

        <div className="sidebar-bottom">
          <div className="pulse-card">
            <div className="pulse-orb">✳</div>
            <strong>Your quality pulse</strong>
            <p>Understand every test run. Release with confidence.</p>
            <span className="pulse-status">
              <span className="status-dot" />
              {error ? "API needs attention" : "Report analytics"}
            </span>
          </div>
          <div className="profile">
            <div className="profile-avatar">TP</div>
            <div className="profile-copy">
              <strong>TestPulse</strong>
              <span>Developer workspace</span>
            </div>
            <span className="profile-menu">···</span>
          </div>
        </div>
      </aside>

      <main className="main-content" id="overview">
        <header className="topbar">
          <div className="breadcrumb">
            <span>Workspace</span>
            <span className="breadcrumb-separator">/</span>
            <strong>Overview</strong>
          </div>
          <div className="topbar-actions">
            <span className="environment-badge">
              <span className="status-dot" />
              {isLoading ? "Connecting..." : error ? "API offline" : "API connected"}
            </span>
            <button
              className="icon-button"
              type="button"
              title="Refresh runs"
              aria-label="Refresh test runs"
              onClick={() => void refreshRuns()}
              disabled={isLoading}
            >
              ↻
            </button>
          </div>
        </header>

        <section className="page-heading">
          <div>
            <div className="eyebrow">
              <span className="eyebrow-line" />
              TEST EXECUTION INTELLIGENCE
            </div>
            <h1>
              Your quality, <span>at a glance.</span>
            </h1>
            <p>
              Track test health, catch regressions, and ship with confidence.
            </p>
          </div>

          <label className="upload-button" id="reports">
            <input
              type="file"
              accept=".xml,application/xml,text/xml"
              onChange={(event) => void handleFileSelection(event)}
              disabled={isUploading}
            />
            <span className="upload-plus">{isUploading ? "…" : "＋"}</span>
            {isUploading ? "Uploading report..." : "Import JUnit report"}
          </label>
        </section>

        {error && (
          <div className="file-selection" role="alert">
            <span className="status-dot" />
            <span>
              <strong>Could not complete the request.</strong> {error}
            </span>
            <button
              type="button"
              onClick={() => void refreshRuns()}
              aria-label="Retry API request"
            >
              Retry
            </button>
          </div>
        )}

        {notice && (
          <div className="file-selection" role="status">
            <span className="status-dot" />
            <span>{notice}</span>
            <button
              type="button"
              onClick={() => setNotice("")}
              aria-label="Dismiss success message"
            >
              ×
            </button>
          </div>
        )}

        <section className="metrics-grid" aria-label="Imported report metrics">
          <article className="metric-card">
            <div className="metric-top">
              <span className="metric-label">TOTAL TEST RUNS</span>
              <span className="metric-icon purple-icon">▤</span>
            </div>
            <div className="metric-value">
              {isLoading && runs.length === 0 ? "…" : runs.length.toLocaleString()}
            </div>
            <div className="metric-foot">
              <span>Saved reports</span>
              <span>· Latest 100 loaded</span>
            </div>
            <div className="mini-bars purple-bars" aria-hidden="true">
              {runs.slice(0, 12).reverse().map((run) => {
                const rate =
                  run.summary.total_tests > 0
                    ? (run.summary.passed / run.summary.total_tests) * 100
                    : 0;
                return (
                  <span
                    key={run.id}
                    style={{ height: `${Math.max(8, rate)}%` }}
                  />
                );
              })}
            </div>
          </article>

          <article className="metric-card">
            <div className="metric-top">
              <span className="metric-label">PASS RATE</span>
              <span className="metric-icon green-icon">✓</span>
            </div>
            <div className="metric-value">
              {passRate === null ? "—" : passRate.toFixed(1)}
              {passRate !== null && <span className="value-unit">%</span>}
            </div>
            <div className="metric-foot">
              <span>Across loaded reports</span>
            </div>
            <div className="progress-track">
              <div
                className="progress-fill pass-fill"
                style={{ width: `${passRate ?? 0}%` }}
              />
            </div>
          </article>

          <article className="metric-card">
            <div className="metric-top">
              <span className="metric-label">FAILED TESTS</span>
              <span className="metric-icon red-icon">!</span>
            </div>
            <div className="metric-value">{totalFailed.toLocaleString()}</div>
            <div className="metric-foot">
              <span>Failures + errors</span>
            </div>
            <div className="failure-strip" aria-label={`${totalFailed} failed tests`}>
              {Array.from({ length: 24 }, (_, index) => (
                <span
                  className={
                    donutTotal > 0 && index < Math.round((totalFailed / donutTotal) * 24)
                      ? "failure-segment hot"
                      : "failure-segment"
                  }
                  key={index}
                />
              ))}
            </div>
          </article>

          <article className="metric-card">
            <div className="metric-top">
              <span className="metric-label">AVG. DURATION</span>
              <span className="metric-icon blue-icon">◷</span>
            </div>
            <div className="metric-value">
              {averageDuration === null ? "—" : formatDuration(averageDuration)}
            </div>
            <div className="metric-foot">
              <span>Average per report</span>
            </div>
            <div className="duration-line" aria-hidden="true">
              <svg viewBox="0 0 220 34" preserveAspectRatio="none">
                <path
                  d="M0 7 C20 8 18 23 38 18 S57 5 76 14 S103 25 121 13 S144 8 162 19 S195 9 220 4"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                />
              </svg>
            </div>
          </article>
        </section>

        <section className="content-grid">
          <article className="panel trend-panel">
            <div className="panel-header">
              <div>
                <h2>Execution trends</h2>
                <p>Pass and fail ratios by imported report</p>
              </div>
              <div className="range-switcher" aria-label="Chart date range">
                {["7 days", "30 days"].map((range) => (
                  <button
                    type="button"
                    key={range}
                    className={selectedRange === range ? "range-active" : ""}
                    onClick={() => setSelectedRange(range)}
                  >
                    {range}
                  </button>
                ))}
              </div>
            </div>

            <div className="chart-legend">
              <span><i className="legend-dot passed-dot" /> Passed rate</span>
              <span><i className="legend-dot failed-dot" /> Failed rate</span>
              <span className="chart-note">
                {chartPoints.length} report{chartPoints.length === 1 ? "" : "s"} shown
              </span>
            </div>

            <div className="chart-area">
              <div className="y-axis">
                <span>100%</span>
                <span>75%</span>
                <span>50%</span>
                <span>25%</span>
                <span>0%</span>
              </div>
              <div className="chart-plot">
                <div className="chart-grid-lines" aria-hidden="true">
                  <span /><span /><span /><span /><span />
                </div>
                <svg
                  className="trend-chart"
                  viewBox="0 0 700 220"
                  preserveAspectRatio="none"
                  role="img"
                  aria-label="Pass and fail percentages for recent imported JUnit reports"
                >
                  <defs>
                    <linearGradient id="passedFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#9b76ff" stopOpacity="0.27" />
                      <stop offset="100%" stopColor="#9b76ff" stopOpacity="0" />
                    </linearGradient>
                  </defs>
                  {chartPoints.length > 0 && (
                    <>
                      <path d={chartAreaPath(chartPoints)} fill="url(#passedFill)" />
                      <path
                        d={chartPath(chartPoints, "passedRate")}
                        fill="none"
                        stroke="#a78bfa"
                        strokeWidth="3"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        vectorEffect="non-scaling-stroke"
                      />
                      <path
                        d={chartPath(chartPoints, "failedRate")}
                        fill="none"
                        stroke="#fb7185"
                        strokeWidth="2.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeDasharray="5 6"
                        vectorEffect="non-scaling-stroke"
                      />
                      {chartPoints.map((point, index) => {
                        const x =
                          chartPoints.length === 1
                            ? 350
                            : (index * 700) / (chartPoints.length - 1);
                        const y = 205 - (point.passedRate / 100) * 180;
                        return (
                          <circle
                            key={`${point.label}-${index}`}
                            cx={x}
                            cy={y}
                            r="4"
                            fill="#10091f"
                            stroke="#b29aff"
                            strokeWidth="2"
                            vectorEffect="non-scaling-stroke"
                          />
                        );
                      })}
                    </>
                  )}
                </svg>
                <div className="x-axis">
                  {chartPoints.map((point, index) => (
                    <span key={`${point.label}-${index}`}>{point.label}</span>
                  ))}
                </div>
              </div>
            </div>
            {chartPoints.length === 0 && (
              <p className="empty-state">
                No reports in this period yet. Import a JUnit XML file to begin.
              </p>
            )}
          </article>

          <article className="panel health-panel">
            <div className="panel-header">
              <div>
                <h2>Suite health</h2>
                <p>Distribution across loaded reports</p>
              </div>
              <span className="health-menu">···</span>
            </div>

            <div className="health-visual">
              <div className="donut-chart" style={{ background: donutBackground }}>
                <div className="donut-center">
                  <strong>
                    {passRate === null ? "—" : passRate.toFixed(1)}
                    {passRate !== null && <span>%</span>}
                  </strong>
                  <small>Passing</small>
                </div>
              </div>
            </div>

            <div className="health-stats">
              <div>
                <span className="health-label">
                  <i className="legend-dot passed-dot" /> Passed
                </span>
                <strong>{totals.passed.toLocaleString()}</strong>
              </div>
              <div>
                <span className="health-label">
                  <i className="legend-dot failed-dot" /> Failed
                </span>
                <strong>{totalFailed.toLocaleString()}</strong>
              </div>
              <div>
                <span className="health-label">
                  <i className="legend-dot skipped-dot" /> Skipped
                </span>
                <strong>{totals.skipped.toLocaleString()}</strong>
              </div>
            </div>

            <div className="health-footer">
              <span className="health-footer-icon">✳</span>
              <span>
                <strong>
                  {runs.length === 0
                    ? "Ready for your first report"
                    : passRate !== null && passRate >= 95
                      ? "Pass rate above 95%"
                      : "Review your test failures"}
                </strong>
                <small>
                  {runs.length === 0
                    ? "Import JUnit XML to see your quality metrics."
                    : `${totals.tests.toLocaleString()} tests across ${totals.suites.toLocaleString()} suites.`}
                </small>
              </span>
            </div>
          </article>
        </section>

        <section className="panel runs-panel" id="recent-runs">
          <div className="panel-header runs-header">
            <div>
              <h2>Recent test runs</h2>
              <p>Your latest saved JUnit reports</p>
            </div>
            <label className="search-box">
              <span>⌕</span>
              <input
                type="search"
                placeholder="Search reports..."
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                aria-label="Search test runs"
              />
            </label>
          </div>

          <div className="table-wrap">
            <table className="runs-table">
              <thead>
                <tr>
                  <th>RUN</th>
                  <th>REPORT FILE</th>
                  <th>RESULTS</th>
                  <th>DURATION</th>
                  <th>STATUS</th>
                </tr>
              </thead>
              <tbody>
                {visibleRuns.map((run) => {
                  const summary = run.summary;
                  const failures = summary.failures + summary.errors;
                  const status = failures > 0 ? "Failed" : "Passed";
                  const expanded = expandedRunId === run.id;
                  const details = runDetailsById[run.id];
                  const detailsError = runDetailsError?.runId === run.id
                    ? runDetailsError.message
                    : "";

                  return (
                    <Fragment key={run.id}>
                      <tr>
                        <td className="run-id">
                          <button
                            type="button"
                            className="run-expand-button"
                            aria-expanded={expanded}
                            aria-label={`${expanded ? "Collapse" : "Expand"} details for run ${run.id}`}
                            onClick={() => toggleRunDetails(run.id)}
                          >
                            <span>{expanded ? "⌄" : "›"}</span> #{run.id}
                          </button>
                        </td>
                        <td>
                          <button
                            type="button"
                            className="run-file-button"
                            aria-expanded={expanded}
                            onClick={() => toggleRunDetails(run.id)}
                          >
                            <span className="suite-name">{run.filename}</span>
                            <span className="branch-name">
                              <span>◷</span> {formatDate(run.created_at)}
                            </span>
                          </button>
                        </td>
                        <td>
                          <div className="result-counts">
                            <span className="result-pass">✓ {summary.passed}</span>
                            <span className="result-fail">× {failures}</span>
                            <span className="result-skip">– {summary.skipped}</span>
                          </div>
                        </td>
                        <td className="duration-cell">
                          {formatDuration(summary.duration_seconds)}
                        </td>
                        <td>
                          <span className={`run-status ${status.toLowerCase()}`}>
                            <span className="status-dot" />
                            {status}
                          </span>
                        </td>
                      </tr>

                      {expanded && (
                        <tr className="run-details-row">
                          <td colSpan={5}>
                            <div className="run-details-panel">
                              <div className="run-details-heading">
                                <div>
                                  <strong>Run #{run.id} details</strong>
                                  <p>{run.filename} · {formatDate(run.created_at)}</p>
                                </div>
                                <button
                                  type="button"
                                  className="details-close-button"
                                  onClick={() => setExpandedRunId(null)}
                                >
                                  Close
                                </button>
                              </div>

                              {loadingRunId === run.id && (
                                <p className="details-state">Loading test cases…</p>
                              )}

                              {detailsError && (
                                <div className="details-error" role="alert">
                                  <span>{detailsError}</span>
                                  <button
                                    type="button"
                                    onClick={() => void loadRunDetails(run.id)}
                                  >
                                    Retry
                                  </button>
                                </div>
                              )}

                              {details && (
                                <>
                                  <div className="run-detail-summary">
                                    <span><strong>{details.summary.total_tests}</strong> tests</span>
                                    <span className="result-pass"><strong>{details.summary.passed}</strong> passed</span>
                                    <span className="result-fail"><strong>{details.summary.failures}</strong> failed</span>
                                    <span className="result-fail"><strong>{details.summary.errors}</strong> errors</span>
                                    <span className="result-skip"><strong>{details.summary.skipped}</strong> skipped</span>
                                    <span><strong>{formatDuration(details.summary.duration_seconds)}</strong> duration</span>
                                  </div>

                                  <div className="test-case-list">
                                    {details.test_cases.map((testCase, index) => (
                                      <article
                                        className="test-case-card"
                                        key={`${run.id}-${testCase.name}-${index}`}
                                      >
                                        <div className="test-case-main">
                                          <span className={`case-status ${testCase.status}`}>
                                            {testCase.status}
                                          </span>
                                          <div className="test-case-title">
                                            <strong>{testCase.name}</strong>
                                            <small>{testCase.class_name}</small>
                                          </div>
                                          <span className="case-duration">
                                            {formatDuration(testCase.duration_seconds)}
                                          </span>
                                        </div>
                                        {testCase.message && (
                                          <p className={`case-message ${testCase.status}`}>
                                            {testCase.message}
                                          </p>
                                        )}
                                      </article>
                                    ))}
                                    {details.test_cases.length === 0 && (
                                      <p className="details-state">No individual test cases were found in this report.</p>
                                    )}
                                  </div>
                                </>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}

                {!isLoading && visibleRuns.length === 0 && (
                  <tr>
                    <td className="empty-state" colSpan={5}>
                      {query
                        ? `No reports match "${query}".`
                        : "No saved reports yet. Import a JUnit XML report to get started."}
                    </td>
                  </tr>
                )}

                {isLoading && runs.length === 0 && (
                  <tr>
                    <td className="empty-state" colSpan={5}>
                      Loading reports…
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="table-footer">
            <span>
              Showing {visibleRuns.length} of {runs.length} loaded reports
            </span>
            <button
              type="button"
              className="table-refresh"
              onClick={() => void refreshRuns()}
              disabled={isLoading}
            >
              Refresh ↻
            </button>
          </div>
        </section>

        {/* New quality trends dashboard */}
        <QualityTrends runs={runs} />

        <RunComparison runs={runs} isLoadingRuns={isLoading} />

        <FailureInsights
          runs={runs}
          isLoadingRuns={isLoading}
          requested={insightsRequested}
          onSelectRun={handleSelectFailureRun}
        />

        <footer className="page-footer">
          <span>
            <span className="footer-spark">✳</span> TestPulse
            <span>·</span> Built for better releases.
          </span>
          <span>Live metrics · JUnit XML analytics</span>
        </footer>
      </main>
    </div>
  );
}

export default App;
