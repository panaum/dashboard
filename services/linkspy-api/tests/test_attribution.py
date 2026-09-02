"""Attribution capture engine — the pure parts.

The browser work needs a real page, so it is exercised by running the CLI
against live URLs. Everything deterministic is pinned here.
"""
import pytest

from attribution import (
    TEST_PARAMS, build_test_url, canonical_for, detect_platform,
    find_tracking, search_storage, attribution_map, CANONICAL,
)


# ── Test URL construction ───────────────────────────────────────────────────
def test_test_url_carries_every_parameter():
    out = build_test_url("https://x.test/lp")
    for key, value in TEST_PARAMS.items():
        assert f"{key}={value}" in out.replace("%5F", "_")


def test_test_url_preserves_existing_query_and_overrides_ours():
    out = build_test_url("https://x.test/lp?keep=1&utm_source=real")
    assert "keep=1" in out
    assert "utm_source=qa" in out
    assert "utm_source=real" not in out, "an existing UTM must not shadow the probe"


def test_bare_host_gets_a_scheme():
    assert build_test_url("x.test/lp").startswith("https://x.test/lp?")


# ── Field-name matching ─────────────────────────────────────────────────────
@pytest.mark.parametrize("name,expected", [
    ("utm_source", "utm_source"),
    ("UTM Source__c", "utm_source"),          # Salesforce-bound rename
    ("ub_utm_campaign", "utm_campaign"),      # Unbounce prefix
    ("hidden_utm_term_1", "utm_term"),        # builder-suffixed
    ("lead[utm_content]", "utm_content"),     # Rails-style bracket name
    ("GoogleClickId", "gclid"),
    ("fbclid", "fbclid"),
    ("email", None),
    ("first_name", None),
    ("", None),
])
def test_canonical_for(name, expected):
    assert canonical_for(name) == expected


def test_every_canonical_name_matches_itself():
    for canon in CANONICAL:
        assert canonical_for(canon) == canon


# ── Platform detection ──────────────────────────────────────────────────────
def test_platform_ignores_brand_words_in_copy():
    """An agency that BUILDS GoHighLevel funnels says so in its marketing.
    Matching the word instead of the platform's hosts reports the wrong
    builder — and therefore the wrong quirks — with total confidence."""
    assert detect_platform("<p>we build done-for-you gohighlevel funnels</p>")[0] == "unknown"
    assert detect_platform('<a href="/unbounce-landing-pages/">Unbounce pages</a>')[0] == "unknown"


def test_platform_detects_real_infrastructure_markers():
    assert detect_platform('<script src="https://x.msgsndr.com/y.js">')[0] == "GoHighLevel"
    assert detect_platform('<div class="lp-pom-root">')[0] == "Unbounce"
    assert detect_platform('<script src="//js.hs-scripts.com/1.js">')[0] == "HubSpot"


def test_wordpress_reports_the_form_plugin():
    plat, note = detect_platform('<link href="/wp-content/x.css"><div class="gform_wrapper">')
    assert plat == "WordPress"
    assert "Gravity Forms" in note


def test_wordpress_without_a_known_plugin_says_so():
    plat, note = detect_platform('<link href="/wp-content/x.css">')
    assert plat == "WordPress"
    assert "unknown" in note.lower()


# ── Tracking IDs ────────────────────────────────────────────────────────────
def test_tracking_ids_are_reported_not_just_presence():
    t = find_tracking('GTM-P593C44 G-HVNDX1EG1J fbq("init","1105630533445518")')
    assert t["gtm"] == ["GTM-P593C44"]
    assert t["ga4"] == ["G-HVNDX1EG1J"]
    assert t["meta_pixel"] == ["1105630533445518"]


def test_snippet_placeholders_are_not_reported_as_live_containers():
    """Found on a real page: GTM-XXXXXXXXXX sits in an un-filled snippet.
    Reporting it as a container is worse than reporting nothing."""
    t = find_tracking("GTM-XXXXXXXXXX and G-XXXXXXX and GTM-AAAA")
    assert t["gtm"] == []
    assert t["ga4"] == []


def test_meta_pixel_found_from_the_image_endpoint_too():
    assert find_tracking("facebook.com/tr?id=998877665544")["meta_pixel"] == ["998877665544"]


# ── Storage fallback ────────────────────────────────────────────────────────
def test_storage_search_finds_sentinels_and_names_where():
    hits = search_storage(
        {"local": {"utm_cache": "utm_source=qa"}, "session": {}},
        [{"name": "_gcl_aw", "value": "GCL.1.QA_TEST_GCLID"}],
    )
    assert "localStorage[utm_cache]" in hits
    assert "cookie[_gcl_aw]" in hits


def test_storage_search_is_quiet_when_nothing_matches():
    assert search_storage({"local": {"theme": "dark"}, "session": {}}, []) == []


# ── Form mapping ────────────────────────────────────────────────────────────
def test_attribution_map_groups_fields_by_parameter():
    forms = [{"frame": "main", "fields": [
        {"name": "utm_source", "value": "qa", "hidden": True},
        {"name": "email", "value": "", "hidden": False},
        {"name": "UTM Campaign__c", "value": "", "hidden": True},
    ]}]
    m = attribution_map(forms)
    assert set(m) == {"utm_source", "utm_campaign"}
    assert m["utm_campaign"][0]["value"] == "", "an empty field is the failure we hunt"
