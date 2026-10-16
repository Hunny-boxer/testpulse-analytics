TestPulse Failure Insights: targeted edits for frontend/src/App.tsx

1) Add this import beside the other imports at the top:

import FailureInsights from "./FailureInsights";

2) Inside App(), below `const [notice, setNotice] = useState("");`, add:

const [activeNav, setActiveNav] = useState("overview");
const [insightsRequested, setInsightsRequested] = useState(false);

3) Replace the Overview link with:

<a
  className={`nav-item ${activeNav === "overview" ? "active" : ""}`}
  href="#overview"
  onClick={() => setActiveNav("overview")}
>
  <span className="nav-icon">◫</span>
  Overview
  <span className="nav-indicator" />
</a>

4) Replace the Test runs link with:

<a
  className={`nav-item ${activeNav === "recent-runs" ? "active" : ""}`}
  href="#recent-runs"
  onClick={() => setActiveNav("recent-runs")}
>
  <span className="nav-icon">◷</span>
  Test runs
</a>

5) Replace the Failure insights link with:

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

6) Replace the Import reports link with:

<a
  className={`nav-item ${activeNav === "reports" ? "active" : ""}`}
  href="#reports"
  onClick={() => setActiveNav("reports")}
>
  <span className="nav-icon">⇧</span>
  Import reports
</a>

7) Find this line in the existing Suite health card:

<article className="panel health-panel" id="failures">

Remove only ` id="failures"`, so it becomes:

<article className="panel health-panel">

8) Immediately before `<footer className="page-footer">`, insert:

<FailureInsights
  runs={runs}
  isLoadingRuns={isLoading}
  requested={insightsRequested}
/>

9) Save App.tsx, then append the full contents of `failure-insights-css.txt` to the END of frontend/src/styles.css.

Keep the existing expanded-run code unchanged. Add the new file `frontend/src/FailureInsights.tsx` using the separate downloaded file.
