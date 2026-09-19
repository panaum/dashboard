"""An alert that fires once, fails to deliver, and advances its own counter
past the rung is a monitoring system that reliably tells you nothing.

D17, confirmed by observation on 2026-09-19: apexure.com's 27-day domain
warning reached a human only because a forced pass collected alerts instead of
sending them. The pass wrote prev_domain_days first and tried to deliver after,
so the next pass compared against the advanced number and found no crossing.
"""
import asyncio

import pytest

from sentinel import NOTIFIED, deliver_alerts, notified_baseline


def run(coro):
    return asyncio.run(coro)


# ─── delivery is confirmed, never assumed ───────────────────────────────────

def test_a_notifier_that_confirms_leaves_nothing_undelivered():
    async def notify(_text):
        return True
    assert run(deliver_alerts(notify, ["a", "b"], "acme.test")) == []


def test_silence_is_not_evidence_of_delivery():
    # The old contract returned None and the caller treated it as success.
    async def returns_none(_text):
        return None
    assert run(deliver_alerts(returns_none, ["a"], "acme.test")) == ["a"]


def test_a_raising_notifier_is_undelivered_not_swallowed(capsys):
    async def boom(_text):
        raise RuntimeError("webhook 404")
    assert run(deliver_alerts(boom, ["urgent"], "acme.test")) == ["urgent"]
    out = capsys.readouterr().out
    assert "NOT DELIVERED" in out and "urgent" in out, "and it says so"


def test_no_notifier_at_all_means_undelivered():
    assert run(deliver_alerts(None, ["a", "b"], "acme.test")) == ["a", "b"]


def test_each_alert_is_judged_on_its_own():
    async def flaky(text):
        return text != "second"
    assert run(deliver_alerts(flaky, ["first", "second", "third"], "h")) == ["second"]


# ─── what we told them, versus what we saw ──────────────────────────────────

def test_the_baseline_is_what_we_last_said():
    prev = {"prev_ssl_days": 5, "prev_domain_days": 5}
    guards = {NOTIFIED: {"ssl_days": 40, "domain_days": 31, "index_overall": "ok",
                         "ssl_problem": None, "guards": {}}}
    told = notified_baseline(prev, guards)
    assert told["ssl_days"] == 40 and told["domain_days"] == 31, (
        "the observed columns moved on; what we delivered did not")


def test_it_falls_back_to_the_observed_columns_on_the_first_pass():
    # Nothing has been recorded as delivered yet. Falling back stops this
    # change re-announcing every rung the old code had already sent.
    told = notified_baseline({"prev_ssl_days": 29, "prev_domain_days": 200}, {})
    assert told["ssl_days"] == 29 and told["domain_days"] == 200
    # Indexability falls back to the verdict the stored columns give, which for
    # an empty row is "unknown" — not "critical", so nothing is announced.
    assert told["index_overall"] != "critical"


def test_an_absent_row_does_not_crash_the_baseline():
    for prev, guards in ((None, None), ({}, {}), (None, {})):
        told = notified_baseline(prev, guards)
        assert set(told) == {"ssl_days", "domain_days", "index_overall",
                             "ssl_problem", "guards"}


# ─── the behaviour that cost apexure.com its warning ────────────────────────

def test_a_failed_delivery_leaves_the_rung_re_armed():
    """The regression this file exists for.

    Pass 1 observes 29 days and fails to deliver. Pass 2 observes 28 and must
    fire the same rung again, because nothing was ever told to a human.
    """
    from sentinel import ladder_crossing, next_notified_state

    stored_guards = {}                                  # nothing delivered yet

    # ── pass 1: 31 → 29 crosses the 30-day rung, delivery fails.
    told = notified_baseline({"prev_ssl_days": 31, "prev_domain_days": 31}, stored_guards)
    assert ladder_crossing(told["domain_days"], 29) == 30, "pass 1 fires"
    undelivered = run(deliver_alerts(None, ["the 30-day warning"], "acme.test"))
    assert undelivered
    stored_guards[NOTIFIED] = next_notified_state(
        told, {"ssl_days": 60, "domain_days": 29, "index_overall": "ok",
               "ssl_problem": None, "guards": {}}, undelivered)

    # ── pass 2: the observation moved to 28, the baseline did not.
    told2 = notified_baseline({"prev_ssl_days": 60, "prev_domain_days": 29}, stored_guards)
    assert told2["domain_days"] == 31, "the baseline is pinned to what we last SAID"
    assert ladder_crossing(told2["domain_days"], 28) == 30, "pass 2 fires again"


def test_it_keeps_firing_until_something_gets_through():
    from sentinel import ladder_crossing, next_notified_state

    stored_guards, observed = {}, 31
    for _ in range(4):                                  # four failed passes
        observed -= 1
        told = notified_baseline({"prev_domain_days": observed + 1}, stored_guards)
        assert ladder_crossing(told["domain_days"], observed) == 30
        stored_guards[NOTIFIED] = next_notified_state(
            told, {"domain_days": observed}, ["still undelivered"])

    # The fifth pass gets through, and only then does the rung go quiet.
    told = notified_baseline({"prev_domain_days": observed}, stored_guards)
    stored_guards[NOTIFIED] = next_notified_state(told, {"domain_days": observed - 1}, [])
    told = notified_baseline({"prev_domain_days": observed - 1}, stored_guards)
    assert ladder_crossing(told["domain_days"], observed - 2) is None


def test_a_delivered_alert_does_not_repeat():
    from sentinel import ladder_crossing
    delivered = {NOTIFIED: {"ssl_days": 29, "domain_days": 29, "index_overall": "ok",
                            "ssl_problem": None, "guards": {}}}
    told = notified_baseline({"prev_ssl_days": 29, "prev_domain_days": 29}, delivered)
    assert ladder_crossing(told["domain_days"], 28) is None


def test_delivery_advances_the_baseline_to_what_was_observed():
    from sentinel import next_notified_state
    told = {"ssl_days": 40, "domain_days": 31, "index_overall": "ok",
            "ssl_problem": None, "guards": {}}
    observed = {"ssl_days": 39, "domain_days": 29, "index_overall": "critical",
                "ssl_problem": "expired", "guards": {"seo": {"overall": "warn"}}}
    assert next_notified_state(told, observed, []) == observed
    assert next_notified_state(told, observed, ["one failed"]) == told


def test_the_index_baseline_falls_back_to_the_stored_verdict():
    # Otherwise the first pass after this change re-announces every homepage
    # that was ALREADY critical — noise about a state nobody changed.
    prev = {"robots_ok": True, "meta_noindex": True,
            "header_noindex": False, "sitemap_ok": True}
    assert notified_baseline(prev, {})["index_overall"] == "critical"
    # And a healthy site still starts from a healthy baseline.
    healthy = {"robots_ok": True, "meta_noindex": False,
               "header_noindex": False, "sitemap_ok": True}
    assert notified_baseline(healthy, {})["index_overall"] != "critical"


def test_a_recorded_baseline_still_wins_over_the_fallback():
    prev = {"robots_ok": True, "meta_noindex": True, "header_noindex": False,
            "sitemap_ok": True}
    guards = {NOTIFIED: {"index_overall": "ok"}}
    assert notified_baseline(prev, guards)["index_overall"] == "ok"
