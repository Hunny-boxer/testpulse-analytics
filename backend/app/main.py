
"""FastAPI application for TestPulse Analytics."""

from pathlib import Path

from fastapi import FastAPI, File, HTTPException, UploadFile

from app.services.junit_parser import (
    JUnitParseError,
    MAX_XML_BYTES,
    parse_junit_xml,
)

app = FastAPI(
    title="TestPulse Analytics",
    description="Import and analyze JUnit XML test reports.",
    version="0.1.0",
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
    """Parse an uploaded JUnit XML report without saving it to disk."""
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

    return {
        "filename": filename[:255],
        **report,
    }
