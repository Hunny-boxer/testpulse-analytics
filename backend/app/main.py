
"""FastAPI application for TestPulse Analytics."""

from fastapi import FastAPI, File, HTTPException, Query, UploadFile

from app.db.database import get_run, list_runs, save_report
from app.services.junit_parser import (
    JUnitParseError,
    MAX_XML_BYTES,
    parse_junit_xml,
)

app = FastAPI(
    title="TestPulse Analytics",
    description="Import and analyze JUnit XML test reports.",
    version="0.2.0",
)


@app.get("/", include_in_schema=False)
def root() -> dict:
    """Provide basic service information."""
    return {
        "service": "TestPulse Analytics",
        "health": "/health",
        "api_docs": "/docs",
    }


@app.get("/health", tags=["health"])
def health_check() -> dict:
    """Return the API health status."""
    return {
        "status": "ok",
        "service": "TestPulse Analytics",
    }


@app.post("/api/v1/reports/upload", tags=["reports"])
async def upload_junit_report(
    file: UploadFile = File(...),
) -> dict:
    """Parse and persist an uploaded JUnit XML report."""
    raw_filename = file.filename or "report.xml"
    filename = raw_filename.replace("\\", "/").split("/")[-1]

    if not filename.lower().endswith(".xml"):
        await file.close()
        raise HTTPException(
            status_code=415,
            detail="Please upload a JUnit report with an .xml filename.",
        )

    try:
        content = await file.read(MAX_XML_BYTES + 1)
    finally:
        await file.close()

    if len(content) > MAX_XML_BYTES:
        raise HTTPException(
            status_code=413,
            detail="XML report exceeds the 10 MiB size limit.",
        )

    try:
        report = parse_junit_xml(content)
    except JUnitParseError as exc:
        raise HTTPException(
            status_code=422,
            detail=str(exc),
        ) from exc

    try:
        saved = save_report(filename[:255], report)
    except Exception as exc:
        # Keep database internals and paths out of API responses.
        raise HTTPException(
            status_code=500,
            detail="The report was parsed but could not be saved.",
        ) from exc

    return {
        "run_id": saved["id"],
        "created_at": saved["created_at"],
        "filename": filename[:255],
        **report,
    }


@app.get("/api/v1/runs", tags=["runs"])
def get_recent_runs(
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
) -> dict:
    """Return recent stored test runs, newest first."""
    try:
        runs = list_runs(limit=limit, offset=offset)
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail="Could not retrieve test runs.",
        ) from exc

    return {
        "count": len(runs),
        "limit": limit,
        "offset": offset,
        "runs": runs,
    }


@app.get("/api/v1/runs/{run_id}", tags=["runs"])
def get_run_details(run_id: int) -> dict:
    """Return one stored run with its suites and test cases."""
    if run_id < 1:
        raise HTTPException(
            status_code=422,
            detail="Run ID must be a positive integer.",
        )

    try:
        run = get_run(run_id)
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail="Could not retrieve test run details.",
        ) from exc

    if run is None:
        raise HTTPException(
            status_code=404,
            detail=f"Test run {run_id} was not found.",
        )

    return run

"""FastAPI application for TestPulse Analytics."""

from fastapi import FastAPI, File, HTTPException, Query, UploadFile

from app.db.database import get_run, list_runs, save_report
from app.services.junit_parser import (
    JUnitParseError,
    MAX_XML_BYTES,
    parse_junit_xml,
)

app = FastAPI(
    title="TestPulse Analytics",
    description="Import and analyze JUnit XML test reports.",
    version="0.2.0",
)


@app.get("/", include_in_schema=False)
def root() -> dict:
    """Provide basic service information."""
    return {
        "service": "TestPulse Analytics",
        "health": "/health",
        "api_docs": "/docs",
    }


@app.get("/health", tags=["health"])
def health_check() -> dict:
    """Return the API health status."""
    return {
        "status": "ok",
        "service": "TestPulse Analytics",
    }


@app.post("/api/v1/reports/upload", tags=["reports"])
async def upload_junit_report(
    file: UploadFile = File(...),
) -> dict:
    """Parse and persist an uploaded JUnit XML report."""
    raw_filename = file.filename or "report.xml"
    filename = raw_filename.replace("\\", "/").split("/")[-1]

    if not filename.lower().endswith(".xml"):
        await file.close()
        raise HTTPException(
            status_code=415,
            detail="Please upload a JUnit report with an .xml filename.",
        )

    try:
        content = await file.read(MAX_XML_BYTES + 1)
    finally:
        await file.close()

    if len(content) > MAX_XML_BYTES:
        raise HTTPException(
            status_code=413,
            detail="XML report exceeds the 10 MiB size limit.",
        )

    try:
        report = parse_junit_xml(content)
    except JUnitParseError as exc:
        raise HTTPException(
            status_code=422,
            detail=str(exc),
        ) from exc

    try:
        saved = save_report(filename[:255], report)
    except Exception as exc:
        # Keep database internals and paths out of API responses.
        raise HTTPException(
            status_code=500,
            detail="The report was parsed but could not be saved.",
        ) from exc

    return {
        "run_id": saved["id"],
        "created_at": saved["created_at"],
        "filename": filename[:255],
        **report,
    }


@app.get("/api/v1/runs", tags=["runs"])
def get_recent_runs(
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
) -> dict:
    """Return recent stored test runs, newest first."""
    try:
        runs = list_runs(limit=limit, offset=offset)
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail="Could not retrieve test runs.",
        ) from exc

    return {
        "count": len(runs),
        "limit": limit,
        "offset": offset,
        "runs": runs,
    }


@app.get("/api/v1/runs/{run_id}", tags=["runs"])
def get_run_details(run_id: int) -> dict:
    """Return one stored run with its suites and test cases."""
    if run_id < 1:
        raise HTTPException(
            status_code=422,
            detail="Run ID must be a positive integer.",
        )

    try:
        run = get_run(run_id)
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail="Could not retrieve test run details.",
        ) from exc

    if run is None:
        raise HTTPException(
            status_code=404,
            detail=f"Test run {run_id} was not found.",
        )

    return run
