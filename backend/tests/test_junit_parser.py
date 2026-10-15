import pytest

from app.services.junit_parser import (
    JUnitParseError,
    parse_junit_xml,
)


SAMPLE_XML = """<?xml version="1.0" encoding="UTF-8"?>
<testsuite name="sample.Suite">
    <testcase classname="sample.LoginTests"
              name="login_passes" time="0.4"/>
    <testcase classname="sample.LoginTests"
              name="login_fails" time="0.5">
        <failure message="Expected 200, got 401">
            Assertion failed
        </failure>
    </testcase>
    <testcase classname="sample.ApiTests"
              name="request_errors" time="0.6">
        <error message="Connection timeout"/>
    </testcase>
    <testcase classname="sample.ApiTests"
              name="request_skipped" time="0">
        <skipped message="Not applicable"/>
    </testcase>
</testsuite>
"""


def test_parses_all_test_outcomes():
    report = parse_junit_xml(SAMPLE_XML)

    assert report["summary"] == {
        "suite_count": 1,
        "total_tests": 4,
        "passed": 1,
        "failures": 1,
        "errors": 1,
        "skipped": 1,
        "duration_seconds": 1.5,
    }


def test_failure_details_are_preserved():
    report = parse_junit_xml(SAMPLE_XML)

    failed = next(
        case
        for case in report["test_cases"]
        if case["name"] == "login_fails"
    )

    assert failed["status"] == "failed"
    assert failed["class_name"] == "sample.LoginTests"
    assert failed["message"] == "Expected 200, got 401"


def test_supports_testsuites_root():
    xml = """<testsuites>
        <testsuite name="suite.one">
            <testcase name="first" time="0.2"/>
        </testsuite>
        <testsuite name="suite.two">
            <testcase name="second" time="0.3"/>
        </testsuite>
    </testsuites>"""

    report = parse_junit_xml(xml)

    assert report["summary"]["suite_count"] == 2
    assert report["summary"]["total_tests"] == 2
    assert report["summary"]["passed"] == 2
    assert report["summary"]["duration_seconds"] == 0.5


@pytest.mark.parametrize(
    "content",
    ["", "   ", "<testsuite>", b"\xff"],
)
def test_rejects_invalid_or_empty_xml(content):
    with pytest.raises(JUnitParseError):
        parse_junit_xml(content)


def test_rejects_unexpected_xml_root():
    with pytest.raises(
        JUnitParseError, match="Unsupported XML root"
    ):
        parse_junit_xml("<root />")


@pytest.mark.parametrize(
    "content",
    [
        '<!DOCTYPE testsuite [<!ENTITY x "value">]><testsuite />',
        '<!ENTITY x "value"><testsuite />',
    ],
)
def test_rejects_dtd_and_entity_declarations(content):
    with pytest.raises(
        JUnitParseError, match="not allowed"
    ):
        parse_junit_xml(content)


def test_rejects_oversized_report():
    oversized = b" " * (10 * 1024 * 1024 + 1)

    with pytest.raises(JUnitParseError, match="10 MiB"):
        parse_junit_xml(oversized)


def test_invalid_and_negative_durations_default_to_zero():
    xml = """<testsuite name="duration-suite">
        <testcase name="invalid" time="abc"/>
        <testcase name="negative" time="-5"/>
    </testsuite>"""

    report = parse_junit_xml(xml)

    assert report["summary"]["duration_seconds"] == 0.0
    assert all(
        case["duration_seconds"] == 0.0
        for case in report["test_cases"]
    )
