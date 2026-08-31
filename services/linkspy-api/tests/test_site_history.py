"""summarize_history — the pure shaping behind /api/qa-bridge/site-history.

Claims: only scalar trend fields cross the bridge (fingerprints, redirect
rules and builder hints stay home); non-numeric values become null rather
than lying; the series is capped; junk rows are ignored.
"""
from qa_bridge import summarize_history, HISTORY_FIELDS, HISTORY_LIMIT


def _row(at="t", **totals):
    base = {"health_score": 90, "total_links": 100, "findings": 1,
            "new": 0, "fixed": 1, "recurring": 0}
    base.update(totals)
    return {"created_at": at, "totals_json": base}


def test_empty_history_is_a_valid_answer():
    assert summarize_history([]) == {"points": []}
    assert summarize_history(None) == {"points": []}


def test_internals_never_cross_the_bridge():
    out = summarize_history([_row(link_fingerprints=["fp"], redirect_rules=[{}], detected_builders=["wp"])])
    point = out["points"][0]
    assert set(point) == {"at", *HISTORY_FIELDS}


def test_non_numeric_values_become_null_not_lies():
    out = summarize_history([_row(health_score="great", findings=None)])
    assert out["points"][0]["health_score"] is None
    assert out["points"][0]["findings"] is None
    assert out["points"][0]["total_links"] == 100


def test_series_is_capped():
    out = summarize_history([_row(at=str(i)) for i in range(HISTORY_LIMIT + 10)])
    assert len(out["points"]) == HISTORY_LIMIT


def test_junk_rows_are_ignored():
    out = summarize_history(["junk", None, _row()])
    assert len(out["points"]) == 1
