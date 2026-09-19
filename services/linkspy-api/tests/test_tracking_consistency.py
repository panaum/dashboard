"""GA4 on 34 of 37 pages is invisible from any one of the 34.

These pin the two things that make the aggregation trustworthy: a page we could
not read is never counted as a page without tracking, and a PASS is only
produced after pages were actually compared.
"""
import tracking_consistency as TC
from tracking_consistency import (consistency_findings, site_tracking_view,
                                  tracking_consistency)


def inv(ga4=(), meta=(), gtm=(), tiktok=()):
    return {"gtm": list(gtm), "ga4": list(ga4), "ua": [], "meta_pixel": list(meta),
            "linkedin": [], "tiktok": list(tiktok), "has_gtag": bool(ga4),
            "has_datalayer": False, "has_event": False, "load_counts": [],
            "any_tracking": bool(ga4 or meta or gtm or tiktok)}


def by_id(findings):
    return {f["id"]: f for f in findings}


# ─── the headline case ──────────────────────────────────────────────────────

def test_a_tag_on_most_pages_but_not_all_is_the_finding():
    pages = {f"https://c.com/p{i}": inv(ga4=["G-ABC"]) for i in range(34)}
    pages.update({f"https://c.com/gap{i}": inv(meta=["999"]) for i in range(3)})

    out = consistency_findings(site_tracking_view(pages))
    gap = by_id(out)["tracking-gap-ga4-G-ABC"]

    assert gap["status"] == "WARN"
    assert gap["title"] == "GA4 G-ABC is on 34 of 37 pages"
    assert len(gap["evidence"]) == 3, "the pages missing it are named"
    assert all(e.startswith("/gap") for e in gap["evidence"])


def test_a_tag_on_a_minority_is_information_not_a_fault():
    # A pixel on three campaign landing pages is a normal setup. Calling it a
    # fault teaches the client to ignore the tool.
    pages = {f"https://c.com/p{i}": inv(ga4=["G-A"]) for i in range(20)}
    for i in range(3):
        pages[f"https://c.com/lp{i}"] = inv(ga4=["G-A"], meta=["555"])

    out = by_id(consistency_findings(site_tracking_view(pages)))
    assert out["tracking-partial-meta_pixel-555"]["status"] == "INFO"
    assert "deliberate" in out["tracking-partial-meta_pixel-555"]["detail"]
    assert "tracking-gap-ga4-G-A" not in out, "GA4 is on every page"


# ─── honesty ────────────────────────────────────────────────────────────────

def test_an_unreadable_page_is_never_a_page_without_tracking():
    pages = {"https://c.com/a": inv(ga4=["G-A"]),
             "https://c.com/b": inv(ga4=["G-A"]),
             "https://c.com/broken": None}

    view = site_tracking_view(pages)
    assert view["pages_read"] == 2
    assert view["pages_unreadable"] == ["https://c.com/broken"]

    out = consistency_findings(view)
    assert [f["status"] for f in out] == ["PASS"]
    assert "tracking-gap-ga4-G-A" not in by_id(out)
    assert "could not be read" in out[0]["detail"], "the gap in our evidence is stated"


def test_consistency_is_not_claimed_from_a_single_page():
    for pages in ({"https://c.com/": inv(ga4=["G-A"])}, {}, {"https://c.com/": None}):
        out = consistency_findings(site_tracking_view(pages))
        assert [f["status"] for f in out] == ["SKIP"], pages
        assert "comparison between pages" in out[0]["detail"]


def test_a_pass_says_what_it_compared():
    pages = {f"https://c.com/p{i}": inv(ga4=["G-A"], gtm=["GTM-X"]) for i in range(5)}
    out = consistency_findings(site_tracking_view(pages))
    assert len(out) == 1 and out[0]["status"] == "PASS"
    assert out[0]["title"] == "Tracking is consistent across 5 pages"
    assert "GA4 G-A" in out[0]["detail"] and "Google Tag Manager GTM-X" in out[0]["detail"]


# ─── the other two real shapes ──────────────────────────────────────────────

def test_two_accounts_of_the_same_kind_split_the_reporting():
    pages = {"https://c.com/a": inv(ga4=["G-OLD"]), "https://c.com/b": inv(ga4=["G-OLD"]),
             "https://c.com/c": inv(ga4=["G-NEW"]), "https://c.com/d": inv(ga4=["G-NEW"])}
    split = by_id(consistency_findings(site_tracking_view(pages)))["tracking-split-ga4"]
    assert split["status"] == "WARN"
    assert sorted(split["evidence"]) == ["G-NEW", "G-OLD"]


def test_nothing_anywhere_is_reported_once_not_per_vendor():
    pages = {f"https://c.com/p{i}": inv() for i in range(4)}
    out = consistency_findings(site_tracking_view(pages))
    assert len(out) == 1 and out[0]["status"] == "WARN"
    assert "any of 4 pages" in out[0]["title"]


def test_a_vendor_seen_without_a_readable_id_still_counts_for_coverage():
    seen = inv()
    seen["meta_pixel"] = ["(present, id not readable)"]
    pages = {"https://c.com/a": seen, "https://c.com/b": inv(), "https://c.com/c": inv()}
    out = by_id(consistency_findings(site_tracking_view(pages)))
    entry = out["tracking-partial-meta_pixel-unidentified"]
    assert "account id not readable" in entry["title"]


# ─── the switch ─────────────────────────────────────────────────────────────

def test_the_check_can_be_switched_off_on_its_own(monkeypatch):
    pages = {f"https://c.com/p{i}": inv(ga4=["G-A"]) for i in range(3)}
    monkeypatch.setenv(TC.FLAG, "0")
    assert tracking_consistency(pages) == {"enabled": False, "pages_read": 0,
                                           "coverage": [], "findings": []}
    monkeypatch.setenv(TC.FLAG, "")
    assert tracking_consistency(pages)["enabled"] is True, "on unless switched off"


def test_no_finding_is_ever_a_failure():
    pages = {"https://c.com/a": inv(ga4=["G-A"]), "https://c.com/b": inv(),
             "https://c.com/c": inv(meta=["1"]), "https://c.com/d": None}
    for f in consistency_findings(site_tracking_view(pages)):
        assert f["status"] in {"PASS", "WARN", "INFO", "SKIP"}, f


# ─── the stored path: the Overview card, between scans ──────────────────────

from tracking_consistency import (consistency_card, pages_from_integrations,
                                  stored_consistency, stored_view, vendor_of)


def row(page, host="", detected_id=None):
    return {"page_url": page, "host": host, "detected_id": detected_id}


def test_the_denominator_comes_from_the_scan_not_from_the_rows():
    # page_integrations has no row for a page carrying no tag. Counting only
    # the pages that appear there would turn "GA4 on 2 of 10" into
    # "GA4 on 2 of 2" — a clean result nobody established.
    rows = [row(f"https://c.com/p{i}", "", "G-ABC") for i in range(2)]

    result = stored_consistency(10, rows)
    assert result["pages_read"] == 10
    entry = result["coverage"][0]
    assert len(entry["pages_with"]) == 2 and entry["missing_count"] == 8
    assert "2 of 10" in result["findings"][0]["title"]


def test_without_the_page_count_it_refuses_to_guess():
    # scans.pages_scanned is null until migrations/027 is applied.
    for absent in (None, 0, "", "ten"):
        result = stored_consistency(absent, [row("https://c.com/a", "", "G-A")])
        assert [f["status"] for f in result["findings"]] == ["SKIP"], repr(absent)
        assert result["card"]["fact"] == "unavailable"


def test_the_stored_path_names_the_pages_it_can_prove():
    # It knows which pages HAVE a tag, never which pages lack it, and the
    # finding says so rather than implying the list is the missing ones.
    rows = [row(f"https://c.com/p{i}", "", "G-A") for i in range(8)]
    finding = stored_consistency(10, rows)["findings"][0]
    assert finding["status"] == "WARN"
    assert "pages listed are the ones that DO carry it" in finding["detail"]
    assert len(finding["evidence"]) == 8


def test_a_tag_cannot_look_present_on_more_pages_than_were_read():
    rows = [row(f"https://c.com/p{i}", "", "G-A") for i in range(12)]
    entry = stored_view(10, rows)["coverage"][0]
    assert entry["share"] <= 1.0 and entry["missing_count"] == 0


def test_vendors_are_read_from_the_id_then_the_host():
    assert vendor_of("www.googletagmanager.com", "GTM-ABC") == "gtm"
    assert vendor_of("whatever.example", "G-ABC") == "ga4"
    assert vendor_of("whatever.example", "UA-1-1") == "ua"
    # No id: a Meta pixel whose id the page does not expose is still present.
    assert vendor_of("connect.facebook.net", None) == "meta_pixel"
    assert vendor_of("snap.licdn.com", "") == "linkedin"
    assert vendor_of("cdn.acme.com", None) is None, "an ordinary CDN is not a tag"


def test_an_unidentified_vendor_is_still_counted():
    entry = stored_view(4, [row("https://c.com/a", "connect.facebook.net")])["coverage"][0]
    assert entry["vendor"] == "meta_pixel" and entry["id"] is None
    assert "account id not readable" in stored_consistency(
        4, [row("https://c.com/a", "connect.facebook.net")])["findings"][0]["title"]


def test_the_scan_time_path_still_names_the_missing_pages():
    # Where the page list IS known, the finding names the pages that lack the
    # tag, which is the more useful half.
    pages = [f"https://c.com/p{i}" for i in range(10)]
    inv = pages_from_integrations(pages, [row(p, "", "G-A") for p in pages[:8]])
    from tracking_consistency import consistency_findings, site_tracking_view
    finding = consistency_findings(site_tracking_view(inv))[0]
    assert finding["evidence"] == ["/p8", "/p9"]
    assert "DO carry it" not in finding["detail"]


# ─── the card ───────────────────────────────────────────────────────────────

def test_the_card_names_the_gap_and_carries_its_urgency():
    rows = ([row(f"https://c.com/p{i}", "", "GTM-X") for i in range(10)]
            + [row("https://c.com/p0", "", "G-A"), row("https://c.com/p1", "", "G-A")])
    card = stored_consistency(10, rows)["card"]
    assert card["key"] == "tracking" and card["label"] == "Tracking"
    assert card["escalation"] == "notice", "a minority is notice, not warn"
    assert "10 pages compared" in card["detail"]
    assert any("2 of 10" in c["text"] for c in card["checks"])


def test_a_real_gap_reads_as_warn():
    rows = [row(f"https://c.com/p{i}", "", "G-A") for i in range(8)]
    card = stored_consistency(10, rows)["card"]
    assert card["escalation"] == "warn" and card["fact"] == "1 to look at"


def test_a_consistent_site_says_so():
    rows = [row(f"https://c.com/p{i}", "", "G-A") for i in range(4)]
    card = stored_consistency(4, rows)["card"]
    assert card["escalation"] == "ok" and card["fact"] == "Consistent"


def test_one_page_is_unavailable_never_green():
    card = stored_consistency(1, [])["card"]
    assert card["escalation"] == "unknown" and card["fact"] == "unavailable"


def test_the_card_is_unavailable_when_the_check_is_off(monkeypatch):
    monkeypatch.setenv(TC.FLAG, "0")
    card = stored_consistency(10, [])["card"]
    assert card["fact"] == "unavailable" and "switched off" in card["detail"]


def test_the_card_shape_matches_its_nine_siblings():
    card = consistency_card(None)
    for key in ("key", "label", "days", "escalation", "fact", "detail"):
        assert key in card, key


def test_one_container_is_not_counted_twice():
    # page_integrations holds several rows for one tag: the inline snippet
    # carries the id, the script resource on the vendor's host does not.
    rows = [row("https://c.com/a", "www.googletagmanager.com", "GTM-ABC"),
            row("https://c.com/a", "www.googletagmanager.com", None),
            row("https://c.com/b", "www.googletagmanager.com", "GTM-ABC"),
            row("https://c.com/b", "www.googletagmanager.com", None)]

    coverage = stored_view(2, rows)["coverage"]
    assert len(coverage) == 1, [f"{c['vendor_label']} {c['id']}" for c in coverage]
    assert coverage[0]["id"] == "GTM-ABC" and len(coverage[0]["pages_with"]) == 2
    assert stored_consistency(2, rows)["card"]["escalation"] == "ok"


def test_a_vendor_with_no_id_anywhere_is_still_reported_once():
    rows = [row("https://c.com/a", "connect.facebook.net", None),
            row("https://c.com/a", "connect.facebook.net", None)]
    coverage = stored_view(2, rows)["coverage"]
    assert len(coverage) == 1 and coverage[0]["id"] is None
