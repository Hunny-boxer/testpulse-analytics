
const API_BASE_URL = (
  import.meta.env.VITE_API_BASE_URL || "http://localhost:8000"
).replace(/\/$/, "");

export type RunSummary = {
  suite_count: number;
  total_tests: number;
  passed: number;
  failures: number;
  errors: number;
  skipped: number;
  duration_seconds: number;
};

export type TestRun = {
  id: number;
  filename: string;
  created_at: string;
  summary: RunSummary;
};

export type RunListResponse = {
  count: number;
  limit: number;
  offset: number;
  runs: TestRun[];
};

export type TestCaseStatus =
  | "passed"
  | "failed"
  | "error"
  | "skipped";

export type TestCaseDetails = {
  suite: string;
  class_name: string;
  name: string;
  status: TestCaseStatus;
  duration_seconds: number;
  message: string | null;
};

export type TestSuiteDetails = {
  name: string;
  total_tests: number;
  passed: number;
  failures: number;
  errors: number;
  skipped: number;
  duration_seconds: number;
};

export type RunDetails = {
  id: number;
  filename: string;
  created_at: string;
  summary: RunSummary;
  test_suites: TestSuiteDetails[];
  test_cases: TestCaseDetails[];
};

export type UploadedReport = {
  run_id: number;
  created_at: string;
  filename: string;
  summary: RunSummary;
  test_suites: TestSuiteDetails[];
  test_cases: TestCaseDetails[];
};

async function requestJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let message = `Request failed (${response.status}).`;

    try {
      const body: unknown = await response.json();

      if (
        typeof body === "object" &&
        body !== null &&
        "detail" in body &&
        typeof body.detail === "string"
      ) {
        message = body.detail;
      }
    } catch {
      // Keep the HTTP status message.
    }

    throw new Error(message);
  }

  return (await response.json()) as T;
}

export async function getRuns(): Promise<RunListResponse> {
  const response = await fetch(
    `${API_BASE_URL}/api/v1/runs?limit=100&offset=0`,
    {
      method: "GET",
      headers: { Accept: "application/json" },
    }
  );

  return requestJson<RunListResponse>(response);
}

export async function getRunDetails(
  runId: number
): Promise<RunDetails> {
  const response = await fetch(
    `${API_BASE_URL}/api/v1/runs/${runId}`,
    {
      method: "GET",
      headers: { Accept: "application/json" },
    }
  );

  return requestJson<RunDetails>(response);
}

export async function uploadReport(
  file: File
): Promise<UploadedReport> {
  const formData = new FormData();
  formData.append("file", file);

  const response = await fetch(
    `${API_BASE_URL}/api/v1/reports/upload`,
    {
      method: "POST",
      body: formData,
    }
  );

  return requestJson<UploadedReport>(response);
}
