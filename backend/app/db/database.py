
"""SQLite persistence for TestPulse test reports."""

from __future__ import annotations

import os
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


DEFAULT_DB_PATH = (
    Path(__file__).resolve().parents[2] / "data" / "db.sqlite3"
)


def _resolve_path(db_path: str | Path | None = None) -> Path:
    """Resolve the database path and create its parent directory."""
    configured_path = db_path or os.getenv("TESTPULSE_DB_PATH")
    path = Path(configured_path) if configured_path else DEFAULT_DB_PATH
    path.parent.mkdir(parents=True, exist_ok=True)
    return path


def _connect(db_path: str | Path | None = None) -> sqlite3.Connection:
    """Open a connection with row access and foreign keys enabled."""
    connection = sqlite3.connect(_resolve_path(db_path))
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    return connection


def initialize_database(
    db_path: str | Path | None = None,
) -> None:
    """Create the TestPulse tables when they do not already exist."""
    connection = _connect(db_path)

    try:
        connection.executescript(
            """
            CREATE TABLE IF NOT EXISTS test_runs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                filename TEXT NOT NULL,
                created_at TEXT NOT NULL,
                suite_count INTEGER NOT NULL,
                total_tests INTEGER NOT NULL,
                passed INTEGER NOT NULL,
                failures INTEGER NOT NULL,
                errors INTEGER NOT NULL,
                skipped INTEGER NOT NULL,
                duration_seconds REAL NOT NULL
            );

            CREATE TABLE IF NOT EXISTS test_suites (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                run_id INTEGER NOT NULL,
                suite_name TEXT NOT NULL,
                total_tests INTEGER NOT NULL,
                passed INTEGER NOT NULL,
                failures INTEGER NOT NULL,
                errors INTEGER NOT NULL,
                skipped INTEGER NOT NULL,
                duration_seconds REAL NOT NULL,
                FOREIGN KEY (run_id)
                    REFERENCES test_runs(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS test_cases (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                run_id INTEGER NOT NULL,
                suite_name TEXT NOT NULL,
                class_name TEXT NOT NULL,
                name TEXT NOT NULL,
                status TEXT NOT NULL CHECK (
                    status IN ('passed', 'failed', 'error', 'skipped')
                ),
                duration_seconds REAL NOT NULL,
                message TEXT,
                FOREIGN KEY (run_id)
                    REFERENCES test_runs(id) ON DELETE CASCADE
            );

            CREATE INDEX IF NOT EXISTS idx_test_runs_created_at
                ON test_runs(created_at);

            CREATE INDEX IF NOT EXISTS idx_test_cases_run_status
                ON test_cases(run_id, status);
            """
        )
        connection.commit()
    finally:
        connection.close()


def save_report(
    filename: str,
    report: dict[str, Any],
    db_path: str | Path | None = None,
) -> dict[str, Any]:
    """Persist a parsed report and return its new run identifier."""
    initialize_database(db_path)

    summary = report["summary"]
    created_at = datetime.now(timezone.utc).isoformat()

    connection = _connect(db_path)

    try:
        with connection:
            cursor = connection.execute(
                """
                INSERT INTO test_runs (
                    filename, created_at, suite_count, total_tests,
                    passed, failures, errors, skipped, duration_seconds
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    filename,
                    created_at,
                    summary["suite_count"],
                    summary["total_tests"],
                    summary["passed"],
                    summary["failures"],
                    summary["errors"],
                    summary["skipped"],
                    summary["duration_seconds"],
                ),
            )
            run_id = cursor.lastrowid

            for suite in report["test_suites"]:
                connection.execute(
                    """
                    INSERT INTO test_suites (
                        run_id, suite_name, total_tests, passed,
                        failures, errors, skipped, duration_seconds
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        run_id,
                        suite["name"],
                        suite["total_tests"],
                        suite["passed"],
                        suite["failures"],
                        suite["errors"],
                        suite["skipped"],
                        suite["duration_seconds"],
                    ),
                )

            for case in report["test_cases"]:
                connection.execute(
                    """
                    INSERT INTO test_cases (
                        run_id, suite_name, class_name, name,
                        status, duration_seconds, message
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        run_id,
                        case["suite"],
                        case["class_name"],
                        case["name"],
                        case["status"],
                        case["duration_seconds"],
                        case["message"],
                    ),
                )

        return {"id": run_id, "created_at": created_at}
    finally:
        connection.close()


def list_runs(
    limit: int = 50,
    offset: int = 0,
    db_path: str | Path | None = None,
) -> list[dict[str, Any]]:
    """Return recent runs with their summary metrics."""
    initialize_database(db_path)
    connection = _connect(db_path)

    try:
        rows = connection.execute(
            """
            SELECT *
            FROM test_runs
            ORDER BY id DESC
            LIMIT ? OFFSET ?
            """,
            (limit, offset),
        ).fetchall()

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
        connection.close()


def get_run(
    run_id: int,
    db_path: str | Path | None = None,
) -> dict[str, Any] | None:
    """Return one run and its suites and cases, or None if not found."""
    initialize_database(db_path)
    connection = _connect(db_path)

    try:
        row = connection.execute(
            "SELECT * FROM test_runs WHERE id = ?",
            (run_id,),
        ).fetchone()

        if row is None:
            return None

        suites = connection.execute(
            """
            SELECT suite_name, total_tests, passed, failures,
                   errors, skipped, duration_seconds
            FROM test_suites
            WHERE run_id = ?
            ORDER BY id
            """,
            (run_id,),
        ).fetchall()

        cases = connection.execute(
            """
            SELECT suite_name, class_name, name, status,
                   duration_seconds, message
            FROM test_cases
            WHERE run_id = ?
            ORDER BY id
            """,
            (run_id,),
        ).fetchall()

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
                    "name": item["suite_name"],
                    "total_tests": item["total_tests"],
                    "passed": item["passed"],
                    "failures": item["failures"],
                    "errors": item["errors"],
                    "skipped": item["skipped"],
                    "duration_seconds": item["duration_seconds"],
                }
                for item in suites
            ],
            "test_cases": [
                {
                    "suite": item["suite_name"],
                    "class_name": item["class_name"],
                    "name": item["name"],
                    "status": item["status"],
                    "duration_seconds": item["duration_seconds"],
                    "message": item["message"],
                }
                for item in cases
            ],
        }
    finally:
        connection.close()
