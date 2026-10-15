
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


def test_upload_valid_junit_report():
    response = client.post(
        "/api/v1/reports/upload",
        files={"file": ("results.xml", VALID_XML, "application/xml")},
    )

    assert response.status_code == 200

    data = response.json()
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
    assert " .xml" not in response.json()["detail"]
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


def test_upload_sanitizes_filename_path():
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
