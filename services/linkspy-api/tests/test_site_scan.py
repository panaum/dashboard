"""summarize_scan — the pure shaping behind /api/qa-bridge/site-scan.

Load-bearing claims: a missing scan is a valid answer (no_scan), never an
error; working links are counted but never itemized; unknown buckets surface
by name instead of vanishing; the flagged list is whitelisted and capped so a
pathological scan can't flood the Deliverables app.
"""
from qa_bridge import summarize_scan, SCAN_FLAG_FIELDS, SCAN_FLAG_LIMIT


def _row(bucket="ok", **kw):
    return {"url": f"https://x.test/{bucket}", "bucket": bucket, "label": bucket, **kw}


def test_no_scan_is_a_valid_answer_not_an_error():
    assert summarize_scan(None) == {"no_scan": True}


def test_empty_results_totals_to_zero():
    out = summarize_scan({"results_json": [], "scanned_at": "t"})
    assert out["totals"] == {"links": 0, "ok": 0, "broken": 0, "unverifiable": 0, "dead_cta": 0}
    assert out["flagged"] == []


def test_ok_rows_are_counted_but_never_itemized():
    out = summarize_scan({"results_json": [_row("ok"), _row("broken")], "scanned_at": "t"})
    assert out["totals"]["ok"] == 1 and out["totals"]["broken"] == 1
    assert [f["bucket"] for f in out["flagged"]] == ["broken"]


def test_missing_bucket_counts_as_ok():
    out = summarize_scan({"results_json": [{"url": "u"}], "scanned_at": "t"})
    assert out["totals"]["ok"] == 1 and out["flagged"] == []


def test_unknown_bucket_surfaces_by_name_instead_of_vanishing():
    out = summarize_scan({"results_json": [_row("mystery")], "scanned_at": "t"})
    assert out["totals"]["mystery"] == 1
    assert out["flagged"][0]["bucket"] == "mystery"


def test_flagged_rows_are_whitelisted():
    out = summarize_scan({"results_json": [_row("broken", secret_header="nope", reason="404")]})
    flagged = out["flagged"][0]
    assert "secret_header" not in flagged
    assert flagged["reason"] == "404"
    assert set(flagged) <= set(SCAN_FLAG_FIELDS)


def test_flagged_list_is_capped():
    rows = [_row("broken") for _ in range(SCAN_FLAG_LIMIT + 50)]
    out = summarize_scan({"results_json": rows})
    assert len(out["flagged"]) == SCAN_FLAG_LIMIT
    assert out["totals"]["broken"] == SCAN_FLAG_LIMIT + 50, "totals stay honest past the cap"


def test_non_dict_rows_are_ignored():
    out = summarize_scan({"results_json": ["junk", None, _row("broken")]})
    assert out["totals"]["links"] == 1 and out["totals"]["broken"] == 1
