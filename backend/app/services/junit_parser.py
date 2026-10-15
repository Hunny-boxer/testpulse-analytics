
"""Parse JUnit XML reports into normalized TestPulse results."""

from __future__ import annotations

import math
from xml.etree import ElementTree as ET


MAX_XML_BYTES = 10 * 1024 * 1024
MAX_MESSAGE_LENGTH = 2000


class JUnitParseError(ValueError):
    """Raised when a JUnit report cannot be safely parsed."""


def _local_name(tag: str) -> str:
    """Return an XML tag name without its namespace."""
    return tag.rsplit("}", 1)[-1]


def _duration(value: str | None) -> float:
    """Parse a non-negative duration; invalid values become zero."""
    if value is None:
        return 0.0

    try:
        seconds = float(value)
    except (TypeError, ValueError):
        return 0.0

    if not math.isfinite(seconds) or seconds < 0:
        return 0.0

    return seconds


def _message(element: ET.Element | None) -> str | None:
    """Extract a bounded failure or error message."""
    if element is None:
        return None

    value = element.get("message") or (element.text or "").strip()
    return value[:MAX_MESSAGE_LENGTH] or None


def parse_junit_xml(xml_content: str | bytes) -> dict:
    """Parse a JUnit XML document into summary, suite, and case records."""
    if isinstance(xml_content, str):
        raw = xml_content.encode("utf-8")
    elif isinstance(xml_content, bytes):
        raw = xml_content
    else:
        raise JUnitParseError("XML content must be text or bytes.")

    # Check size first so oversized content is rejected consistently,
    # including content that contains only whitespace.
    if len(raw) > MAX_XML_BYTES:
        raise JUnitParseError("XML report exceeds the 10 MiB size limit.")

    if not raw or not raw.strip():
        raise JUnitParseError("XML content is empty.")

    # JUnit reports do not need DTDs or custom entity declarations.
    upper_raw = raw.upper()
    if b"<!DOCTYPE" in upper_raw or b"<!ENTITY" in upper_raw:
        raise JUnitParseError("DTD and entity declarations are not allowed.")

    try:
        root = ET.fromstring(raw)
    except (ET.ParseError, ValueError) as exc:
        raise JUnitParseError("The report is not valid XML.") from exc

    root_name = _local_name(root.tag)

    if root_name == "testsuite":
        suites = [root]
    elif root_name == "testsuites":
        suites = [
            node for node in root.iter()
            if _local_name(node.tag) == "testsuite"
        ]
    else:
        raise JUnitParseError(
            "Unsupported XML root. Expected testsuite or testsuites."
        )

    if not suites:
        raise JUnitParseError("No test suites were found.")

    test_cases: list[dict] = []
    test_suites: list[dict] = []

    for suite in suites:
        suite_name = suite.get("name") or "unnamed-suite"
        suite_cases: list[dict] = []

        for case in suite:
            if _local_name(case.tag) != "testcase":
                continue

            children = {
                _local_name(child.tag): child
                for child in case
            }

            if "error" in children:
                status = "error"
                message = _message(children["error"])
            elif "failure" in children:
                status = "failed"
                message = _message(children["failure"])
            elif "skipped" in children:
                status = "skipped"
                message = _message(children["skipped"])
            else:
                status = "passed"
                message = None

            result = {
                "suite": suite_name,
                "class_name": case.get("classname") or suite_name,
                "name": case.get("name") or "unnamed-test",
                "status": status,
                "duration_seconds": round(
                    _duration(case.get("time")), 3
                ),
                "message": message,
            }

            suite_cases.append(result)
            test_cases.append(result)

        def count(status: str) -> int:
            return sum(
                1 for item in suite_cases if item["status"] == status
            )

        test_suites.append({
            "name": suite_name,
            "total_tests": len(suite_cases),
            "passed": count("passed"),
            "failures": count("failed"),
            "errors": count("error"),
            "skipped": count("skipped"),
            "duration_seconds": round(
                sum(item["duration_seconds"] for item in suite_cases), 3
            ),
        })

    def total(status: str) -> int:
        return sum(1 for item in test_cases if item["status"] == status)

    summary = {
        "suite_count": len(test_suites),
        "total_tests": len(test_cases),
        "passed": total("passed"),
        "failures": total("failed"),
        "errors": total("error"),
        "skipped": total("skipped"),
        "duration_seconds": round(
            sum(item["duration_seconds"] for item in test_cases), 3
        ),
    }

    return {
        "summary": summary,
        "test_suites": test_suites,
        "test_cases": test_cases,
    }
