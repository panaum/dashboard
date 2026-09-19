"""A rule remembered in six places will be forgotten in a seventh.

It already was: when D15 was written the audit listed six unguarded render
paths, and main._capture_screenshot made seven, and the scan's own render armed
its guard only while clicking things open, not for the page load.

So the guard is not a habit here, it is a structure. Nothing creates a browser
context of its own, and this file fails the build when something starts.
"""
import asyncio
import re
from pathlib import Path

import pytest

import outbound
from outbound import Ledger, guarded_context, guarded_context_async

ROOT = Path(__file__).resolve().parents[1]
BEACON = "https://www.facebook.com/tr?id=1&ev=PageView"
TAG_SCRIPT = "https://www.googletagmanager.com/gtm.js?id=GTM-ABC"

# The one caller allowed to switch the guard off, and why.
EXEMPT_FILES = {"consent_render.py"}


_COMMENT = re.compile(r"#[^\n]*")
_STRING = re.compile(r"(\"\"\".*?\"\"\"|\'\'\'.*?\'\'\')", re.S)


def code_only(src: str) -> str:
    """Source with comments and docstrings removed.

    The rules below read code, not prose. A comment that names the hole it is
    warning about must not be mistaken for the hole.
    """
    return _COMMENT.sub("", _STRING.sub("", src))


def sources():
    for path in sorted(ROOT.glob("*.py")):
        if path.name != "outbound.py":
            yield path, code_only(path.read_text())


# ─── the structural rule ────────────────────────────────────────────────────

def test_nothing_but_outbound_creates_a_browser_context():
    offenders = [p.name for p, src in sources() if re.search(r"\.new_context\s*\(", src)]
    assert offenders == [], (
        "These create a Playwright context directly, so no collector route "
        f"reaches it: {offenders}. Use outbound.guarded_context instead.")


def test_nothing_calls_browser_new_page():
    # browser.new_page() quietly builds a context of its own. It is the same
    # hole with a friendlier name.
    offenders = [p.name for p, src in sources()
                 if re.search(r"\bbrowser\s*\.\s*new_page\s*\(", src)]
    assert offenders == [], offenders


def test_every_caller_says_what_it_is_for():
    for path, src in sources():
        for call in re.findall(r"guarded_context(?:_async)?\s*\((.{0,200})", src, re.S):
            assert "purpose=" in call, f"{path.name}: guarded_context without purpose="


def test_only_the_documented_caller_switches_the_guard_off():
    users = {p.name for p, src in sources() if "allow_collectors=" in src}
    assert users == EXEMPT_FILES, (
        f"Opting out of the collector guard is allowed in {EXEMPT_FILES} only; "
        f"found {users}. If a new one is genuinely needed, add it here with its "
        "reason so the exemption is reviewed rather than inherited.")


def test_the_opt_out_must_carry_a_written_reason():
    for name in EXEMPT_FILES:
        src = (ROOT / name).read_text()
        reasons = re.findall(r"allow_collectors\s*=\s*(.{0,80})", src, re.S)
        assert reasons, name
        for reason in reasons:
            assert not reason.lstrip().startswith(("True", "1", "\"\"", "''")), (
                f"{name}: allow_collectors takes a sentence, not a boolean")


# ─── the predicate ──────────────────────────────────────────────────────────

def test_the_guard_refuses_what_the_checker_refuses():
    # One predicate for both outbound paths, so they cannot drift apart.
    assert outbound._refuse(BEACON) is True
    assert outbound._refuse("https://www.google-analytics.com/g/collect?v=2") is True
    assert outbound._refuse("https://www.google.com/ccm/collect") is True


def test_the_guard_still_loads_tag_scripts():
    # A render that blocks gtm.js is not measuring the client's page.
    assert outbound._refuse(TAG_SCRIPT) is False
    assert outbound._refuse("https://connect.facebook.net/en_US/fbevents.js") is False
    assert outbound._refuse("https://client.com/hero.png") is False


# ─── behaviour, against a double ────────────────────────────────────────────

class FakeRequest:
    def __init__(self, url): self.url = url


class FakeRoute:
    def __init__(self): self.aborted = False
    def abort(self): self.aborted = True


class FakeContext:
    def __init__(self): self.routes, self.events = [], {}
    def route(self, predicate, handler): self.routes.append((predicate, handler))
    def on(self, event, fn): self.events.setdefault(event, []).append(fn)


class FakeBrowser:
    def __init__(self): self.context, self.kwargs = FakeContext(), None
    def new_context(self, **kw): self.kwargs = kw; return self.context


class FakeAsyncContext(FakeContext):
    async def route(self, predicate, handler): self.routes.append((predicate, handler))


class FakeAsyncBrowser:
    def __init__(self): self.context, self.kwargs = FakeAsyncContext(), None
    async def new_context(self, **kw): self.kwargs = kw; return self.context


def fire(context, url):
    predicate, handler = context.routes[0]
    assert predicate(url)
    route = FakeRoute()
    handler(route, FakeRequest(url))
    return route


def test_a_guarded_context_aborts_the_beacon_and_records_it():
    browser = FakeBrowser()
    context, ledger = guarded_context(browser, purpose="test", viewport={"width": 800})

    assert browser.kwargs == {"viewport": {"width": 800}}, "kwargs pass through"
    assert ledger.guarded and len(context.routes) == 1
    assert fire(context, BEACON).aborted
    assert ledger.blocked == [BEACON]


def test_the_async_twin_behaves_identically():
    browser = FakeAsyncBrowser()
    context, ledger = asyncio.run(
        guarded_context_async(browser, purpose="test", locale="en-AU"))

    assert browser.kwargs == {"locale": "en-AU"}
    assert fire(context, BEACON).aborted
    assert ledger.blocked == [BEACON]


def test_opting_out_installs_no_route_and_says_why(capsys):
    browser = FakeBrowser()
    _, ledger = guarded_context(browser, purpose="consent render",
                                allow_collectors="recording them is the measurement")
    assert browser.context.routes == [], "nothing is intercepted"
    assert not ledger.guarded
    assert ledger.exempt_reason == "recording them is the measurement"
    assert "collector guard OFF" in capsys.readouterr().out, "an exemption is loud"


def test_an_empty_reason_is_not_an_opt_out():
    for empty in ("", "   ", None):
        _, ledger = guarded_context(FakeBrowser(), purpose="t", allow_collectors=empty)
        assert ledger.guarded, repr(empty)


def test_a_request_that_slips_through_is_recorded_as_a_leak():
    # An aborted request never finishes, so this stays empty in normal
    # operation. If it does not, the predicate has a gap.
    browser = FakeBrowser()
    context, ledger = guarded_context(browser, purpose="test")
    for fn in context.events["requestfinished"]:
        fn(FakeRequest(BEACON))
        fn(FakeRequest(TAG_SCRIPT))
    assert ledger.leaked == [BEACON], "only collectors count as leaks"


def test_the_leak_watcher_runs_even_when_exempt():
    # consent_render still wants to know what fired; it just does not block it.
    _, ledger = guarded_context(FakeBrowser(), purpose="t", allow_collectors="because")
    assert isinstance(ledger, Ledger) and ledger.leaked == []
