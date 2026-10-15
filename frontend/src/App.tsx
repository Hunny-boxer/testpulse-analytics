
import { useMemo, useState } from "react";

type TestRun = {
  id: string;
  name: string;
  branch: string;
  date: string;
  duration: string;
  passed: number;
  failed: number;
  skipped: number;
  status: "Passed" | "Failed";
};

const runs: TestRun[] = [
  {
    id: "#1842",
    name: "API regression suite",
    branch: "feat/auth-refresh",
    date: "Oct 15, 2026 · 11:24 AM",
    duration: "48s",
    passed: 128,
    failed: 0,
    skipped: 2,
    status: "Passed",
  },
  {
    id: "#1841",
    name: "UI checkout flow",
    branch: "main",
    date: "Oct 15, 2026 · 10:52 AM",
    duration: "2m 14s",
    passed: 84,
    failed: 3,
    skipped: 1,
    status: "Failed",
  },
  {
    id: "#1840",
    name: "Smoke tests",
    branch: "release/2.4",
    date: "Oct 15, 2026 · 09:41 AM",
    duration: "36s",
    passed: 46,
    failed: 0,
    skipped: 0,
    status: "Passed",
  },
  {
    id: "#1839",
    name: "Payment service tests",
    branch: "feat/payment-retry",
    date: "Oct 14, 2026 · 05:18 PM",
    duration: "1m 06s",
    passed: 67,
    failed: 2,
    skipped: 3,
    status: "Failed",
  },
];

const trend = [
  { day: "09", passed: 72, failed: 12 },
  { day: "10", passed: 84, failed: 8 },
  { day: "11", passed: 76, failed: 14 },
  { day: "12", passed: 91, failed: 6 },
  { day: "13", passed: 87, failed: 9 },
  { day: "14", passed: 95, failed: 5 },
  { day: "15", passed: 98, failed: 3 },
];

function App() {
  const [query, setQuery] = useState("");
  const [selectedFile, setSelectedFile] = useState("");
  const [activeRange, setActiveRange] = useState("7 days");

  const visibleRuns = useMemo(() => {
    const normalized = query.trim().toLowerCase();

    return runs.filter((run) =>
      `${run.id} ${run.name} ${run.branch} ${run.status}`
        .toLowerCase()
        .includes(normalized)
    );
  }, [query]);

  const totalPassed = 1248;
  const totalFailed = 27;
  const passRate = (
    (totalPassed / (totalPassed + totalFailed)) *
    100
  ).toFixed(1);

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#" aria-label="TestPulse home">
          <span className="brand-mark">T</span>
          <span className="brand-name">
            Test<span>Pulse</span>
          </span>
        </a>

        <div className="workspace-label">WORKSPACE</div>
        <div className="workspace-switcher">
          <span className="workspace-avatar">H</span>
          <span className="workspace-copy">
            <strong>Hunny's workspace</strong>
            <small>Free workspace</small>
          </span>
          <span className="chevron">⌄</span>
        </div>

        <nav className="side-nav" aria-label="Main navigation">
          <p className="nav-label">ANALYTICS</p>
          <a className="nav-item active" href="#overview">
            <span className="nav-icon">◫</span>
            Overview
            <span className="nav-indicator" />
          </a>
          <a className="nav-item" href="#recent-runs">
            <span className="nav-icon">◷</span>
            Test runs
          </a>
          <a className="nav-item" href="#failures">
            <span className="nav-icon">⊗</span>
            Failure insights
            <span className="nav-count">5</span>
          </a>

          <p className="nav-label nav-label-spaced">MANAGE</p>
          <a className="nav-item" href="#reports">
            <span className="nav-icon">⇧</span>
            Import reports
          </a>
          <a className="nav-item" href="#settings">
            <span className="nav-icon">⚙</span>
            Settings
          </a>
        </nav>

        <div className="sidebar-bottom">
          <div className="pulse-card">
            <div className="pulse-orb">✳</div>
            <strong>Your quality pulse</strong>
            <p>Your test analytics, all in one place.</p>
            <span className="pulse-status">
              <span className="status-dot" /> All systems operational
            </span>
          </div>
          <div className="profile">
            <div className="profile-avatar">HB</div>
            <div className="profile-copy">
              <strong>Hunny Boxer</strong>
              <span>Developer</span>
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
              <span className="status-dot" /> Demo environment
            </span>
            <button
              className="icon-button"
              type="button"
              aria-label="Notifications"
              title="Notifications"
            >
              ♧
              <span className="notification-dot" />
            </button>
          </div>
        </header>

        <section className="page-heading">
          <div>
            <div className="eyebrow">
              <span className="eyebrow-line" /> TEST EXECUTION INTELLIGENCE
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
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) setSelectedFile(file.name);
              }}
            />
            <span className="upload-plus">＋</span>
            Import JUnit report
          </label>
        </section>

        {selectedFile && (
          <div className="file-selection" role="status">
            <span className="status-dot" />
            <span>
              <strong>{selectedFile}</strong> selected. Backend upload
              integration is coming next.
            </span>
            <button
              type="button"
              onClick={() => setSelectedFile("")}
              aria-label="Clear selected report"
            >
              ×
            </button>
          </div>
        )}

        <section className="metrics-grid" aria-label="Test metrics">
          <article className="metric-card">
            <div className="metric-top">
              <span className="metric-label">TOTAL TEST RUNS</span>
              <span className="metric-icon purple-icon">▤</span>
            </div>
            <div className="metric-value">1,284</div>
            <div className="metric-foot">
              <span className="trend-up">↗ 12.8%</span>
              <span>vs. previous period</span>
            </div>
            <div className="mini-bars purple-bars" aria-hidden="true">
              {[28, 40, 34, 60, 45, 68, 53, 76, 61, 88, 72, 100].map(
                (height, index) => (
                  <span key={index} style={{ height: `${height}%` }} />
                )
              )}
            </div>
          </article>

          <article className="metric-card">
            <div className="metric-top">
              <span className="metric-label">PASS RATE</span>
              <span className="metric-icon green-icon">✓</span>
            </div>
            <div className="metric-value">
              {passRate}
              <span className="value-unit">%</span>
            </div>
            <div className="metric-foot">
              <span className="trend-up">↗ 2.4%</span>
              <span>vs. previous period</span>
            </div>
            <div className="progress-track">
              <div
                className="progress-fill pass-fill"
                style={{ width: `${passRate}%` }}
              />
            </div>
          </article>

          <article className="metric-card">
            <div className="metric-top">
              <span className="metric-label">FAILED TESTS</span>
              <span className="metric-icon red-icon">!</span>
            </div>
            <div className="metric-value">{totalFailed}</div>
            <div className="metric-foot">
              <span className="trend-down">↓ 8.3%</span>
              <span>vs. previous period</span>
            </div>
            <div className="failure-strip" aria-label="27 failed tests">
              {Array.from({ length: 24 }, (_, index) => (
                <span
                  className={index < 7 ? "failure-segment hot" : "failure-segment"}
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
              1m 42s
            </div>
            <div className="metric-foot">
              <span className="trend-up">↓ 6.1%</span>
              <span>faster than before</span>
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
                <p>Test outcomes over time</p>
              </div>
              <div className="range-switcher" aria-label="Chart date range">
                {["7 days", "30 days"].map((range) => (
                  <button
                    type="button"
                    key={range}
                    className={activeRange === range ? "range-active" : ""}
                    onClick={() => setActiveRange(range)}
                  >
                    {range}
                  </button>
                ))}
              </div>
            </div>

            <div className="chart-legend">
              <span><i className="legend-dot passed-dot" /> Passed</span>
              <span><i className="legend-dot failed-dot" /> Failed</span>
              <span className="chart-note">Sample data · {activeRange}</span>
            </div>

            <div className="chart-area">
              <div className="y-axis">
                <span>100</span>
                <span>75</span>
                <span>50</span>
                <span>25</span>
                <span>0</span>
              </div>
              <div className="chart-plot">
                <div className="chart-grid-lines" aria-hidden="true">
                  <span />
                  <span />
                  <span />
                  <span />
                  <span />
                </div>
                <svg
                  className="trend-chart"
                  viewBox="0 0 700 220"
                  preserveAspectRatio="none"
                  role="img"
                  aria-label="Sample chart showing passed tests trending upward and failed tests trending downward"
                >
                  <defs>
                    <linearGradient id="passedFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#9b76ff" stopOpacity="0.27" />
                      <stop offset="100%" stopColor="#9b76ff" stopOpacity="0" />
                    </linearGradient>
                  </defs>
                  <path
                    d="M0 72 L116 47 L233 64 L350 30 L466 39 L583 18 L700 11 L700 220 L0 220 Z"
                    fill="url(#passedFill)"
                  />
                  <path
                    d="M0 72 L116 47 L233 64 L350 30 L466 39 L583 18 L700 11"
                    fill="none"
                    stroke="#a78bfa"
                    strokeWidth="3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    vectorEffect="non-scaling-stroke"
                  />
                  <path
                    d="M0 165 L116 183 L233 155 L350 191 L466 175 L583 197 L700 204"
                    fill="none"
                    stroke="#fb7185"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeDasharray="5 6"
                    vectorEffect="non-scaling-stroke"
                  />
                  {[0, 116, 233, 350, 466, 583, 700].map((x, index) => (
                    <circle
                      key={x}
                      cx={x}
                      cy={[72, 47, 64, 30, 39, 18, 11][index]}
                      r="4"
                      fill="#10091f"
                      stroke="#b29aff"
                      strokeWidth="2"
                      vectorEffect="non-scaling-stroke"
                    />
                  ))}
                </svg>
                <div className="x-axis">
                  {trend.map((point) => <span key={point.day}>{point.day}</span>)}
                </div>
              </div>
            </div>
          </article>

          <article className="panel health-panel" id="failures">
            <div className="panel-header">
              <div>
                <h2>Suite health</h2>
                <p>Current test distribution</p>
              </div>
              <span className="health-menu">···</span>
            </div>

            <div className="health-visual">
              <div className="donut-chart">
                <div className="donut-center">
                  <strong>97.9<span>%</span></strong>
                  <small>Passing</small>
                </div>
              </div>
            </div>

            <div className="health-stats">
              <div>
                <span className="health-label"><i className="legend-dot passed-dot" /> Passed</span>
                <strong>1,248</strong>
              </div>
              <div>
                <span className="health-label"><i className="legend-dot failed-dot" /> Failed</span>
                <strong>27</strong>
              </div>
              <div>
                <span className="health-label"><i className="legend-dot skipped-dot" /> Skipped</span>
                <strong>9</strong>
              </div>
            </div>

            <div className="health-footer">
              <span className="health-footer-icon">✳</span>
              <span>
                <strong>Looking good</strong>
                <small>Your pass rate is above the 95% target.</small>
              </span>
            </div>
          </article>
        </section>

        <section className="panel runs-panel" id="recent-runs">
          <div className="panel-header runs-header">
            <div>
              <h2>Recent test runs</h2>
              <p>Your latest automated executions</p>
            </div>
            <label className="search-box">
              <span>⌕</span>
              <input
                type="search"
                placeholder="Search runs..."
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
                  <th>SUITE / BRANCH</th>
                  <th>RESULTS</th>
                  <th>DURATION</th>
                  <th>STATUS</th>
                </tr>
              </thead>
              <tbody>
                {visibleRuns.map((run) => (
                  <tr key={run.id}>
                    <td className="run-id">{run.id}</td>
                    <td>
                      <div className="suite-name">{run.name}</div>
                      <div className="branch-name">
                        <span>⑂</span> {run.branch}
                      </div>
                    </td>
                    <td>
                      <div className="result-counts">
                        <span className="result-pass">✓ {run.passed}</span>
                        <span className="result-fail">× {run.failed}</span>
                        <span className="result-skip">– {run.skipped}</span>
                      </div>
                    </td>
                    <td className="duration-cell">{run.duration}</td>
                    <td>
                      <span className={`run-status ${run.status.toLowerCase()}`}>
                        <span className="status-dot" />
                        {run.status}
                      </span>
                    </td>
                  </tr>
                ))}
                {visibleRuns.length === 0 && (
                  <tr>
                    <td className="empty-state" colSpan={5}>
                      No runs match “{query}”.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="table-footer">
            <span>Showing {visibleRuns.length} of {runs.length} sample runs</span>
            <a href="#overview">Back to overview ↑</a>
          </div>
        </section>

        <footer className="page-footer">
          <span><span className="footer-spark">✳</span> TestPulse <span>·</span> Built for better releases.</span>
          <span>UI preview · Report API integration next</span>
        </footer>
      </main>
    </div>
  );
}

export default App;
