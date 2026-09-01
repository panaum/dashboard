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


# ─── check_snapshot (dashboard-run checks) ───────────────────────────────────
from qa_bridge import check_snapshot


def test_unknown_check_is_a_typed_not_found():
    assert check_snapshot(None) == {"status": "not_found"}


def test_snapshot_whitelists_and_drops_internals():
    snap = check_snapshot({"status": "running", "url": "u", "task": object(),
                           "started_at": 1.0, "progress": {"percent": 40, "message": "m"}})
    assert snap == {"status": "running", "url": "u", "progress": {"percent": 40, "message": "m"}}


def test_done_snapshot_carries_summary_and_failed_carries_error():
    done = check_snapshot({"status": "done", "url": "u", "summary": {"totals": {}}})
    assert "summary" in done and "error" not in done
    failed = check_snapshot({"status": "failed", "url": "u", "error": "scan timed out"})
    assert failed["error"] == "scan timed out"


# ─── summarize_full_scan (in-dashboard scanner) ──────────────────────────────
from qa_bridge import summarize_full_scan, FULL_LINK_FIELDS


def _link(bucket="ok", zones=None, **kw):
    return {"url": f"https://x.test/{bucket}", "bucket": bucket, "label": bucket,
            "anchor_text": "Link", "zones": zones if zones is not None else ["body"],
            "occurrences": 1, "secret_internal": "nope", **kw}


def test_full_scan_whitelists_link_fields_and_adds_zone():
    out = summarize_full_scan([_link("broken", zones=["nav", "footer"])])
    link = out["links"][0]
    assert link["zone"] == "nav", "primary zone = first of the zones list"
    assert "secret_internal" not in link
    assert set(link) <= set(FULL_LINK_FIELDS) | {"zone"}


def test_full_scan_counts_and_placements():
    out = summarize_full_scan(
        [_link("ok", occurrences=3), _link("broken"), _link("redirect")],
        breakdowns={"link_types": {"anchor": 3}}, health_score=88, total_placements=5,
    )
    assert out["totals"] == {"links": 3, "ok": 2, "broken": 1, "unverifiable": 0, "dead_cta": 0}
    assert out["unique_links"] == 3
    assert out["placements"] == 5
    assert out["health_score"] == 88
    assert out["breakdowns"]["link_types"] == {"anchor": 3}


def test_full_scan_placements_default_to_summed_occurrences():
    out = summarize_full_scan([_link("ok", occurrences=4), _link("ok", occurrences=2)])
    assert out["placements"] == 6


def test_full_scan_ignores_non_dict_rows():
    out = summarize_full_scan(["junk", None, _link("broken")])
    assert out["totals"]["links"] == 1
