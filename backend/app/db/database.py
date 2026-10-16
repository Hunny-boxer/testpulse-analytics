
"""Portable SQLite and PostgreSQL persistence for TestPulse."""

from __future__ import annotations

import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from sqlalchemy import (
    CheckConstraint,
    Column,
    Float,
    ForeignKey,
    Index,
    Integer,
    MetaData,
    String,
    Table,
    Text,
    create_engine,
    select,
)
from sqlalchemy.engine import URL, Engine


DEFAULT_DB_PATH = (
    Path(__file__).resolve().parents[2] / "data" / "db.sqlite3"
)

metadata = MetaData()

test_runs = Table(
    "test_runs",
    metadata,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("filename", String(255), nullable=False),
    Column("created_at", String, nullable=False),
    Column("suite_count", Integer, nullable=False),
    Column("total_tests", Integer, nullable=False),
    Column("passed", Integer, nullable=False),
    Column("failures", Integer, nullable=False),
    Column("errors", Integer, nullable=False),
    Column("skipped", Integer, nullable=False),
    Column("duration_seconds", Float, nullable=False),
)

test_suites = Table(
    "test_suites",
    metadata,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column(
        "run_id",
        Integer,
        ForeignKey("test_runs.id", ondelete="CASCADE"),
        nullable=False,
    ),
    Column("suite_name", String, nullable=False),
    Column("total_tests", Integer, nullable=False),
    Column("passed", Integer, nullable=False),
    Column("failures", Integer, nullable=False),
    Column("errors", Integer, nullable=False),
    Column("skipped", Integer, nullable=False),
    Column("duration_seconds", Float, nullable=False),
)

test_cases = Table(
    "test_cases",
    metadata,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column(
        "run_id",
        Integer,
        ForeignKey("test_runs.id", ondelete="CASCADE"),
        nullable=False,
    ),
    Column("suite_name", String, nullable=False),
    Column("class_name", String, nullable=False),
    Column("name", String, nullable=False),
    Column("status", String, nullable=False),
    Column("duration_seconds", Float, nullable=False),
    Column("message", Text, nullable=True),
    CheckConstraint(
        "status IN ('passed', 'failed', 'error', 'skipped')",
        name="ck_test_cases_status",
    ),
)

Index("idx_test_runs_created_at", test_runs.c.created_at)
Index("idx_test_cases_run_status", test_cases.c.run_id, test_cases.c.status)


def _create_engine(db_path: str | Path | None = None) -> Engine:
    """Create an engine using an explicit path, database URL, or SQLite."""

    # An explicit path or TESTPULSE_DB_PATH selects SQLite.
    # This preserves isolated SQLite databases in the existing test suite.
    configured_path = db_path or os.getenv("TESTPULSE_DB_PATH")

    if configured_path is not None:
        path = Path(configured_path)
        path.parent.mkdir(parents=True, exist_ok=True)

        return create_engine(
            URL.create("sqlite", database=str(path)),
            connect_args={"check_same_thread": False},
        )

    database_url = (
        os.getenv("TESTPULSE_DATABASE_URL")
        or os.getenv("DATABASE_URL")
    )

    if database_url:
        # Render and some database providers supply postgres:// URLs.
        if database_url.startswith("postgres://"):
            database_url = database_url.replace(
                "postgres://",
                "postgresql+psycopg://",
                1,
            )
        elif database_url.startswith("postgresql://"):
            database_url = database_url.replace(
                "postgresql://",
                "postgresql+psycopg://",
                1,
            )

        return create_engine(database_url, pool_pre_ping=True)

    # Local development fallback.
    DEFAULT_DB_PATH.parent.mkdir(parents=True, exist_ok=True)

    return create_engine(
        URL.create("sqlite", database=str(DEFAULT_DB_PATH)),
        connect_args={"check_same_thread": False},
    )


def initialize_database(
    db_path: str | Path | None = None,
) -> None:
    """Create the report tables and indexes if they do not exist."""
    engine = _create_engine(db_path)

    try:
        metadata.create_all(engine)
    finally:
        engine.dispose()


def save_report(
    filename: str,
    report: dict[str, Any],
    db_path: str | Path | None = None,
) -> dict[str, Any]:
    """Persist a parsed report and return its run ID and creation time."""
    initialize_database(db_path)

    summary = report["summary"]
    created_at = datetime.now(timezone.utc).isoformat()
    engine = _create_engine(db_path)

    try:
        with engine.begin() as connection:
            result = connection.execute(
                test_runs.insert().values(
                    filename=filename,
                    created_at=created_at,
                    suite_count=summary["suite_count"],
                    total_tests=summary["total_tests"],
                    passed=summary["passed"],
                    failures=summary["failures"],
                    errors=summary["errors"],
                    skipped=summary["skipped"],
                    duration_seconds=summary["duration_seconds"],
                )
            )
            run_id = int(result.inserted_primary_key[0])

            for suite in report["test_suites"]:
                connection.execute(
                    test_suites.insert().values(
                        run_id=run_id,
                        suite_name=suite["name"],
                        total_tests=suite["total_tests"],
                        passed=suite["passed"],
                        failures=suite["failures"],
                        errors=suite["errors"],
                        skipped=suite["skipped"],
                        duration_seconds=suite["duration_seconds"],
                    )
                )

            for case in report["test_cases"]:
                connection.execute(
                    test_cases.insert().values(
                        run_id=run_id,
                        suite_name=case["suite"],
                        class_name=case["class_name"],
                        name=case["name"],
                        status=case["status"],
                        duration_seconds=case["duration_seconds"],
                        message=case["message"],
                    )
                )

        return {"id": run_id, "created_at": created_at}
    finally:
        engine.dispose()


def list_runs(
    limit: int = 50,
    offset: int = 0,
    db_path: str | Path | None = None,
) -> list[dict[str, Any]]:
    """Return recent test runs with their summary metrics."""
    initialize_database(db_path)
    engine = _create_engine(db_path)

    try:
        with engine.connect() as connection:
            rows = connection.execute(
                select(test_runs)
                .order_by(test_runs.c.id.desc())
                .limit(limit)
                .offset(offset)
            ).mappings().all()

            return [
                {
                    "id": row["id"],
                    "filename": row["filename"],
                    "created_at": row["created_at"],
                    "summary": {
                        "suite_count": row["suite_count"],
                        "total_tests": row["total_tests"],
                        "passed": row["passed"],
                        "failures": row["failures"],
                        "errors": row["errors"],
                        "skipped": row["skipped"],
                        "duration_seconds": row["duration_seconds"],
                    },
                }
                for row in rows
            ]
    finally:
        engine.dispose()


def get_run(
    run_id: int,
    db_path: str | Path | None = None,
) -> dict[str, Any] | None:
    """Return a run with its suites and cases, or None if it is missing."""
    initialize_database(db_path)
    engine = _create_engine(db_path)

    try:
        with engine.connect() as connection:
            row = connection.execute(
                select(test_runs).where(test_runs.c.id == run_id)
            ).mappings().first()

            if row is None:
                return None

            suites = connection.execute(
                select(test_suites)
                .where(test_suites.c.run_id == run_id)
                .order_by(test_suites.c.id)
            ).mappings().all()

            cases = connection.execute(
                select(test_cases)
                .where(test_cases.c.run_id == run_id)
                .order_by(test_cases.c.id)
            ).mappings().all()

            return {
                "id": row["id"],
                "filename": row["filename"],
                "created_at": row["created_at"],
                "summary": {
                    "suite_count": row["suite_count"],
                    "total_tests": row["total_tests"],
                    "passed": row["passed"],
                    "failures": row["failures"],
                    "errors": row["errors"],
                    "skipped": row["skipped"],
                    "duration_seconds": row["duration_seconds"],
                },
                "test_suites": [
                    {
                        "name": suite["suite_name"],
                        "total_tests": suite["total_tests"],
                        "passed": suite["passed"],
                        "failures": suite["failures"],
                        "errors": suite["errors"],
                        "skipped": suite["skipped"],
                        "duration_seconds": suite["duration_seconds"],
                    }
                    for suite in suites
                ],
                "test_cases": [
                    {
                        "suite": case["suite_name"],
                        "class_name": case["class_name"],
                        "name": case["name"],
                        "status": case["status"],
                        "duration_seconds": case["duration_seconds"],
                        "message": case["message"],
                    }
                    for case in cases
                ],
            }
    finally:
        engine.dispose()
