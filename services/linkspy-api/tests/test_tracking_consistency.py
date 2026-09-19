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
