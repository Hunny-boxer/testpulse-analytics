"""FastAPI application for TestPulse Analytics."""

import logging
import os

from fastapi import Depends, FastAPI, File, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from app.auth import get_current_user
from app.db.database import get_run, list_runs, save_report
from app.services.junit_parser import (
    JUnitParseError,
    MAX_XML_BYTES,
    parse_junit_xml,
)

# Log detailed exceptions to the service logs, not to API responses.
logger = logging.getLogger(__name__)

app = FastAPI(
    title="TestPulse Analytics",
    description="Import and analyze JUnit XML test reports.",
    version="0.3.0",
)

# Allow local development and explicitly configured deployment origins.
cors_origins = [
    origin.strip()
    for origin in os.getenv(
        "TESTPULSE_CORS_ORIGINS",
        "http://localhost:5173,http://127.0.0.1:5173",
    ).split(",")
    if origin.strip()
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
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
    """Return the API health status without requiring a user session."""
    return {
        "status": "ok",
        "service": "TestPulse Analytics",
    }


@app.post("/api/v1/reports/upload", tags=["reports"])
async def upload_junit_report(
    file: UploadFile = File(...),
    current_user: dict[str, str] = Depends(get_current_user),
) -> dict:
    """Parse and persist a JUnit XML report for the authenticated user."""
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
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    try:
        saved = save_report(
            filename[:255],
            report,
            owner_user_id=current_user["id"],
        )
    except Exception as exc:
        logger.exception("Database write failed while saving a JUnit report")
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
    current_user: dict[str, str] = Depends(get_current_user),
) -> dict:
    """Return only the authenticated user's stored test runs."""
    try:
        runs = list_runs(
            limit=limit,
            offset=offset,
            owner_user_id=current_user["id"],
        )
    except Exception as exc:
        logger.exception("Database query failed while retrieving test runs")
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
def get_run_details(
    run_id: int,
    current_user: dict[str, str] = Depends(get_current_user),
) -> dict:
    """Return a run only when it belongs to the authenticated user."""
    if run_id < 1:
        raise HTTPException(
            status_code=422,
            detail="Run ID must be a positive integer.",
        )

    try:
        run = get_run(
            run_id,
            owner_user_id=current_user["id"],
        )
    except Exception as exc:
        logger.exception(
            "Database query failed while retrieving test run details"
        )
        raise HTTPException(
            status_code=500,
            detail="Could not retrieve test run details.",
        ) from exc

    if run is None:
        # The run may not exist, or it may belong to another user.
        # Return the same response for both cases to avoid leaking its existence.
        raise HTTPException(
            status_code=404,
            detail="Test run was not found.",
        )

    return run
