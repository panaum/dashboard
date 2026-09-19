"""A missing column must not read as a missing table.

D16: the old predicate tested for the substring "does not exist", which is the
text of `relation "x" does not exist` AND of `column x does not exist`. One
check answered two opposite questions at ~115 call sites, so a schema gap
anywhere read as "this table is not migrated yet" and the write vanished. Five
migrations went unnoticed that way.
"""
import pytest

import database as D
from database import (_column_missing, _looks_like_missing_column,
                      _tables_missing, schema_gap, schema_gaps)


class APIError(Exception):
    """Shaped like the postgrest error: str(e) hides the code, the attribute has it."""

    def __init__(self, code, message):
        super().__init__(message)
        self.code, self.message = code, message


# The four errors the live project actually returns.
MISSING_TABLE_PGRST = APIError(
    "PGRST205", "Could not find the table 'public.third_party_hosts' in the schema cache")
MISSING_TABLE_PG = APIError("42P01", 'relation "watchdog_alerts" does not exist')
MISSING_COLUMN_PG = APIError("42703", "column sentinel_status.guards does not exist")
MISSING_COLUMN_PGRST = APIError(
    "PGRST204", "Could not find the 'pages_scanned' column of 'scans' in the schema cache")


@pytest.fixture(autouse=True)
def _clean_registry():
    D._SCHEMA_GAPS.clear()
    yield
    D._SCHEMA_GAPS.clear()


# ─── classification ─────────────────────────────────────────────────────────

def test_a_missing_table_is_a_table():
    assert schema_gap(MISSING_TABLE_PGRST) == ("table", "third_party_hosts")
    assert schema_gap(MISSING_TABLE_PG) == ("table", "watchdog_alerts")


def test_a_missing_column_is_a_column_in_either_phrasing():
    assert schema_gap(MISSING_COLUMN_PG) == ("column", "sentinel_status.guards")
    # PostgREST puts the name BEFORE the word "column"; reading left to right
    # for "column" here yields "of".
    assert schema_gap(MISSING_COLUMN_PGRST) == ("column", "pages_scanned")


def test_an_error_that_is_not_a_schema_gap_is_not_one():
    for e in (APIError("42501", "new row violates row-level security policy"),
              APIError("23505", "duplicate key value violates unique constraint"),
              Exception("connection reset by peer")):
        assert schema_gap(e) is None, e


# ─── the rule the whole file exists for ─────────────────────────────────────

def test_a_missing_column_is_not_reported_as_a_missing_table():
    assert _tables_missing(MISSING_TABLE_PGRST) is True
    assert _tables_missing(MISSING_TABLE_PG) is True
    assert _tables_missing(MISSING_COLUMN_PG) is False, "this is D16"
    assert _tables_missing(MISSING_COLUMN_PGRST) is False


def test_a_column_gap_seen_by_a_table_tolerant_caller_is_recorded_then_raised():
    assert _tables_missing(MISSING_COLUMN_PG) is False
    gap = next(g for g in schema_gaps() if g["kind"] == "column")
    assert gap["name"] == "sentinel_status.guards"
    assert gap["swallowed"] is False, "it surfaces rather than vanishing"


def test_column_checks_name_the_column_they_mean():
    assert _column_missing(MISSING_COLUMN_PG, "guards") is True
    assert _column_missing(MISSING_COLUMN_PG, "pages_scanned") is False
    assert _column_missing(MISSING_TABLE_PG, "guards") is False
    assert _looks_like_missing_column(MISSING_COLUMN_PGRST) is True
    assert _looks_like_missing_column(MISSING_TABLE_PGRST) is False


# ─── it has to be answerable ────────────────────────────────────────────────

def test_every_gap_is_counted_and_named():
    for _ in range(3):
        _tables_missing(MISSING_TABLE_PG)
    _column_missing(MISSING_COLUMN_PG, "guards")

    by_key = {(g["kind"], g["name"]): g for g in schema_gaps()}
    assert by_key[("table", "watchdog_alerts")]["count"] == 3
    assert by_key[("table", "watchdog_alerts")]["swallowed"] is True
    assert by_key[("column", "sentinel_status.guards")]["count"] == 1


def test_the_registry_is_empty_when_the_schema_is_whole():
    assert schema_gaps() == []


def test_the_loudest_gap_sorts_first():
    for _ in range(5):
        _tables_missing(MISSING_TABLE_PGRST)
    _tables_missing(MISSING_TABLE_PG)
    assert schema_gaps()[0]["name"] == "third_party_hosts"


def test_a_gap_says_so_the_first_time(capsys):
    _tables_missing(MISSING_TABLE_PG)
    out = capsys.readouterr().out
    assert "MISSING table watchdog_alerts" in out
    assert "migrations/README.md" in out, "the message says what to do about it"
