
from fastapi.testclient import TestClient

from app.main import app
from app.services.junit_parser import MAX_XML_BYTES


client = TestClient(app)


VALID_XML = b"""<?xml version="1.0"?>
<testsuite name="api-tests">
    <testcase classname="LoginTests" name="login_passes" time="0.2"/>
    <testcase classname="LoginTests" name="login_fails" time="0.3">
        <failure message="Expected 200, got 401"/>
    </testcase>
</testsuite>
"""


def use_test_database(monkeypatch, tmp_path):
    """Give each database test an isolated temporary SQLite file."""
    monkeypatch.setenv(
        "TESTPULSE_DB_PATH",
        str(tmp_path / "testpulse-test.sqlite3"),
    )


def upload_valid_report():
    return client.post(
        "/api/v1/reports/upload",
        files={"file": ("results.xml", VALID_XML, "application/xml")},
    )


def test_health_endpoint_returns_ok():
    response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {
        "status": "ok",
        "service": "TestPulse Analytics",
    }


def test_root_endpoint_returns_service_information():
    response = client.get("/")

    assert response.status_code == 200
    assert response.json()["service"] == "TestPulse Analytics"
    assert response.json()["health"] == "/health"
    assert response.json()["api_docs"] == "/docs"


def test_upload_valid_junit_report(monkeypatch, tmp_path):
    use_test_database(monkeypatch, tmp_path)

    response = upload_valid_report()

    assert response.status_code == 200

    data = response.json()
    assert data["run_id"] > 0
    assert data["created_at"]
    assert data["filename"] == "results.xml"
    assert data["summary"]["suite_count"] == 1
    assert data["summary"]["total_tests"] == 2
    assert data["summary"]["passed"] == 1
    assert data["summary"]["failures"] == 1

    failed = next(
        case for case in data["test_cases"]
        if case["status"] == "failed"
    )
    assert failed["message"] == "Expected 200, got 401"


def test_upload_rejects_non_xml_filename():
    response = client.post(
        "/api/v1/reports/upload",
        files={"file": ("results.txt", VALID_XML, "text/plain")},
    )

    assert response.status_code == 415
    assert ".xml" in response.json()["detail"]


def test_upload_rejects_malformed_xml():
    response = client.post(
        "/api/v1/reports/upload",
        files={"file": ("broken.xml", b"<testsuite>", "application/xml")},
    )

    assert response.status_code == 422
    assert response.json()["detail"] == "The report is not valid XML."


def test_upload_rejects_empty_xml():
    response = client.post(
        "/api/v1/reports/upload",
        files={"file": ("empty.xml", b"", "application/xml")},
    )

    assert response.status_code == 422
    assert response.json()["detail"] == "XML content is empty."


def test_upload_rejects_oversized_report():
    oversized = b"x" * (MAX_XML_BYTES + 1)

    response = client.post(
        "/api/v1/reports/upload",
        files={"file": ("large.xml", oversized, "application/xml")},
    )

    assert response.status_code == 413
    assert "10 MiB" in response.json()["detail"]


def test_upload_sanitizes_filename_path(monkeypatch, tmp_path):
    use_test_database(monkeypatch, tmp_path)

    response = client.post(
        "/api/v1/reports/upload",
        files={
            "file": (
                "../../results.xml",
                VALID_XML,
                "application/xml",
            )
        },
    )

    assert response.status_code == 200
    assert response.json()["filename"] == "results.xml"
    assert response.json()["run_id"] > 0


def test_list_runs_returns_persisted_reports(monkeypatch, tmp_path):
    use_test_database(monkeypatch, tmp_path)

    uploaded = upload_valid_report()
    assert uploaded.status_code == 200

    response = client.get("/api/v1/runs")

    assert response.status_code == 200
    data = response.json()
    assert data["count"] == 1
    assert data["limit"] == 50
    assert data["offset"] == 0
    assert data["runs"][0]["id"] == uploaded.json()["run_id"]
    assert data["runs"][0]["filename"] == "results.xml"
    assert data["runs"][0]["summary"]["total_tests"] == 2


def test_run_details_include_suites_and_cases(monkeypatch, tmp_path):
    use_test_database(monkeypatch, tmp_path)

    uploaded = upload_valid_report()
    run_id = uploaded.json()["run_id"]

    response = client.get(f"/api/v1/runs/{run_id}")

    assert response.status_code == 200
    data = response.json()
    assert data["id"] == run_id
    assert data["summary"]["total_tests"] == 2
    assert data["test_suites"][0]["name"] == "api-tests"
    assert len(data["test_cases"]) == 2


def test_run_details_return_404_when_missing(monkeypatch, tmp_path):
    use_test_database(monkeypatch, tmp_path)

    response = client.get("/api/v1/runs/99999")

    assert response.status_code == 404
    assert response.json()["detail"] == "Test run 99999 was not found."


def test_runs_endpoint_validates_pagination():
    response = client.get("/api/v1/runs?limit=0")

    assert response.status_code == 422
