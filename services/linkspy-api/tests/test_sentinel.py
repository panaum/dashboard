"""Disaster Sentinel pure logic — the numbers and thresholds that drive alerts."""
from datetime import datetime, timezone, timedelta

from sentinel import (days_until, escalation, ladder_crossing, indexability_verdict,
                      downtime_state, uptime_pct, summarize_sentinel)

NOW = datetime(2026, 7, 12, 12, 0, tzinfo=timezone.utc)


def test_days_until_floors_and_handles_timezone_edges():
    # expires in ~2 hours today → 0 days remaining, not 1
    soon = (NOW + timedelta(hours=2)).isoformat()
    assert days_until(soon, NOW) == 0
    assert days_until((NOW + timedelta(days=14, hours=5)).isoformat(), NOW) == 14
    # a 'Z'-suffixed / naive timestamp still parses
    assert days_until("2026-07-15T12:00:00Z", NOW) == 3
    # unknown expiry (RDAP hid it) → None, never a guess
    assert days_until(None, NOW) is None


def test_escalation_tiers():
    assert escalation(None) == "unknown"
    assert escalation(2) == "critical"
    assert escalation(3) == "critical"
    assert escalation(10) == "warn"
    assert escalation(14) == "warn"
    assert escalation(20) == "notice"
    assert escalation(30) == "notice"
    assert escalation(90) == "ok"


def test_ladder_crossing_is_change_only():
    assert ladder_crossing(40, 29) == 30     # crossed 30 rung
    assert ladder_crossing(29, 20) is None   # still between 30 and 14, no new rung
    assert ladder_crossing(15, 13) == 14     # crossed 14
    assert ladder_crossing(5, 2) == 3        # crossed 3
    assert ladder_crossing(None, 2) == 3     # first-ever check already critical
    assert ladder_crossing(2, 1) is None     # already past 3, no re-alert


def test_indexability_noindex_via_meta_or_header_is_critical():
    v_meta = indexability_verdict(True, True, False, True)
    assert v_meta["overall"] == "critical"
    v_header = indexability_verdict(True, False, True, True)
    assert v_header["overall"] == "critical"
    v_robots = indexability_verdict(False, False, False, True)
    assert v_robots["overall"] == "critical"
    # only a broken sitemap → a lesser notice, not critical (existing pages stay indexed)
    v_sitemap = indexability_verdict(True, False, False, False)
    assert v_sitemap["overall"] == "notice"
    # all good
    assert indexability_verdict(True, False, False, True)["overall"] == "ok"
    # couldn't determine any → unknown, shown honestly
    assert indexability_verdict(None, None, None, None)["overall"] == "unknown"


def test_downtime_needs_two_consecutive_failures():
    assert downtime_state([False, False, True]) is True     # two in a row → outage
    assert downtime_state([False, True, False]) is False    # single blip, not down
    assert downtime_state([True, True]) is False
    assert downtime_state([False]) is False                 # not enough data


def test_uptime_pct():
    assert uptime_pct([True, True, True, False]) == 75.0
    assert uptime_pct([]) is None
    assert uptime_pct([True, None, True]) == 100.0          # None pings ignored


def test_summarize_puts_most_urgent_card_first_and_honest_unavailable():
    status = {
        "ssl_expiry": (NOW + timedelta(days=200)).isoformat(), "ssl_issuer": "Let's Encrypt",
        "domain_expiry": None,   # registry hid it
        "robots_ok": True, "meta_noindex": True, "header_noindex": False, "sitemap_ok": True,
        "last_checked_at": NOW.isoformat(),
    }
    s = summarize_sentinel(status, pings=[True] * 100, now=NOW)
    # noindex → search-visibility card is critical → sorts to first (proximity=prominence)
    assert s["cards"][0]["key"] == "index"
    assert s["worst"] == "critical"
    # domain expiry unavailable, surfaced honestly
    dom = next(c for c in s["cards"] if c["key"] == "domain")
    assert dom["fact"] == "unavailable" and dom["escalation"] == "unknown"
    assert s["uptime_pct"] == 100.0


# ─── certificates that renew themselves ─────────────────────────────────────
# Every certificate in the portfolio today is 89 or 90 days (Let's Encrypt or
# Google Trust Services). An ACME client renews at a third of lifetime, so the
# 30-day rung is where these certs RENEW — the one rung a healthy cert reaches,
# and the only one it ever reaches. 14 and 3 are never crossed unless renewal
# has actually failed, which is why they are kept.
from sentinel import cert_lifetime_days, is_automated, ladder_for, AUTOMATED_LADDER

LE_ISSUED = "2026-08-12T00:00:00+00:00"
LE_EXPIRY = "2026-11-09T00:00:00+00:00"          # 89 days, apexure.com's real pair


def test_lifetime_is_read_from_the_certificate_and_never_guessed():
    assert cert_lifetime_days(LE_ISSUED, LE_EXPIRY) == 89
    assert cert_lifetime_days(None, LE_EXPIRY) is None
    assert cert_lifetime_days(LE_ISSUED, None) is None
    assert cert_lifetime_days("not a date", LE_EXPIRY) is None
    assert cert_lifetime_days(LE_EXPIRY, LE_ISSUED) is None, "expiry before issue is nonsense, not a lifetime"


def test_an_unknown_lifetime_is_never_treated_as_automated():
    # Suppressing a warning on a guess is how a manual renewal gets missed.
    assert is_automated(None) is False
    assert ladder_for(None) == (30, 14, 3)
    assert is_automated(89) is True and is_automated(90) is True
    assert is_automated(365) is False, "an annual certificate is renewed by a human"
    assert ladder_for(89) == AUTOMATED_LADDER


def test_a_90_day_certificate_stays_green_through_its_own_renewal():
    assert escalation(34, 89) == "ok", "roadmap.thepeakfp.com today"
    assert escalation(30, 89) == "ok", "the moment it renews — today this reads 'notice'"
    assert escalation(11, 89) == "ok"
    assert escalation(10, 89) == "warn", "twenty days of failed retries is a real fault"
    assert escalation(4, 89) == "warn"
    assert escalation(3, 89) == "critical"
    assert escalation(0, 89) == "critical"


def test_a_certificate_renewed_by_hand_keeps_every_rung():
    assert escalation(30, 365) == "notice"
    assert escalation(14, 365) == "warn"
    assert escalation(3, 365) == "critical"
    assert escalation(30) == "notice", "no lifetime known: unchanged"
    assert escalation(None, 89) == "unknown"


def test_the_slack_alert_stops_firing_on_a_healthy_renewal_cycle():
    # The live false alarm: every site crosses 31 -> 30 every cycle.
    assert ladder_crossing(31, 30, 89) is None
    assert ladder_crossing(31, 30) == 30, "without a known lifetime, unchanged"
    assert ladder_crossing(31, 30, 365) == 30, "an annual cert still warns a month out"
    # The rungs that mean something still fire, once each.
    assert ladder_crossing(11, 10, 89) == 10
    assert ladder_crossing(10, 9, 89) is None, "change-only: already reported"
    assert ladder_crossing(4, 3, 89) == 3


def test_the_card_reads_the_recorded_cycle_and_says_what_it_is():
    status = {"ssl_expiry": (NOW + timedelta(days=30)).isoformat(), "ssl_issuer": "Let's Encrypt",
              "guards": {"ssl_cycle": {"issued": LE_ISSUED, "lifetime_days": 89}}}
    card = next(c for c in summarize_sentinel(status, [], NOW)["cards"] if c["key"] == "ssl")
    assert card["escalation"] == "ok"
    assert card["fact"] == "30 days"
    assert card["detail"] == "Let's Encrypt · 89-day cycle"


def test_without_a_recorded_cycle_the_card_is_exactly_what_it_was():
    status = {"ssl_expiry": (NOW + timedelta(days=30)).isoformat(), "ssl_issuer": "Let's Encrypt"}
    card = next(c for c in summarize_sentinel(status, [], NOW)["cards"] if c["key"] == "ssl")
    assert card["escalation"] == "notice"
    assert card["detail"] == "Let's Encrypt"
