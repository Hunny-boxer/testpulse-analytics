import { Fragment, useEffect, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { getRunDetails, getRuns, uploadReport } from "./api";
import Auth from "./Auth";
import { supabase } from "./supabase";
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
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(false);
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

  // Restore the Supabase session and listen for sign-in/sign-out events.
  useEffect(() => {
    let mounted = true;

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!mounted) return;

      setSession(nextSession);
      setAuthReady(true);
    });

    void supabase.auth
      .getSession()
      .then(({ data, error: sessionError }) => {
        if (!mounted) return;

        if (sessionError) {
          setError(sessionError.message);
        }

        setSession(data.session);
        setAuthReady(true);
      })
      .catch((authError: unknown) => {
        if (!mounted) return;

        setError(
          authError instanceof Error
            ? authError.message
            : "Could not load the authentication session."
        );
        setAuthReady(true);
      });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  // Load data only after authentication is ready and a user is signed in.
  useEffect(() => {
    if (!authReady) return;

    // Do not retain report details between user sessions.
    setRuns([]);
    setRunDetailsById({});
    setExpandedRunId(null);
    setRunDetailsError(null);

    if (!session) {
      setIsLoading(false);
      setError("");
      setNotice("");
      return;
    }

    void refreshRuns();
  }, [authReady, session]);

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

    return `${line} L${lastX} 205 L${points.length === 1 ? 350
