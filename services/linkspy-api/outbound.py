"""
The one place a browser is pointed at a client's page.

D15 found the checker firing clients' tracking because the analytics guard was
installed in the browser and the checker was a second outbound path. The fix
there was a guard at the checker's GET. This is the same lesson applied to the
renders, and applied structurally: **a rule that has to be remembered in six
places will be forgotten in a seventh.** There already was a seventh
(`main._capture_screenshot`), and an eighth, and the scan's own render turned
out to arm its guard only during click-reveal and not for the page load.

So no module creates a browser context of its own. They all come from here,
with the collector route already armed, and `tests/test_outbound_guard.py`
fails the build if a new caller creates one directly.

What is refused is `beacons.beacon_reason`: the same predicate the checker
uses, so the two outbound paths cannot drift apart. Tag *scripts* still load,
because a render that blocks gtag.js is not measuring the client's page — it is
measuring a page nobody has. Only the endpoints that record a hit are aborted.

**Opting out is possible and deliberately awkward.** `allow_collectors` takes a
written reason, not a boolean, so nobody switches the guard off by passing
True, and the justification lives at the call site. `consent_render` is the one
caller that uses it: recording every third-party request under each consent
state is the whole measurement, and a guard would erase the finding.

Every context keeps a ledger — what was refused, and what got through anyway.
`leaked` should stay empty; if it does not, the predicate has a gap and the
caller can say so in its own output rather than silently polluting a client.
"""
from beacons import beacon_reason


class Ledger:
    """What one context's guard did. Cheap, and always present."""

    __slots__ = ("blocked", "leaked", "exempt_reason")

    def __init__(self, exempt_reason: str = ""):
        self.blocked: list[str] = []
        self.leaked: list[str] = []
        self.exempt_reason = exempt_reason

    @property
    def guarded(self) -> bool:
        return not self.exempt_reason

    def __repr__(self) -> str:
        if self.exempt_reason:
            return f"<Ledger exempt: {self.exempt_reason}>"
        return f"<Ledger blocked={len(self.blocked)} leaked={len(self.leaked)}>"


def _refuse(url: str) -> bool:
    """Route predicate. True means this request records a hit somewhere."""
    return bool(beacon_reason(url))


def _watch_leaks(context, ledger: Ledger) -> None:
    """Anything matching the predicate that still completed is a gap in it.

    An aborted request never fires `requestfinished`, so in normal operation
    this list stays empty. It is the guard's own regression test, running in
    production.
    """
    def note(request):
        try:
            if _refuse(request.url):
                ledger.leaked.append(request.url[:200])
        except Exception:
            pass
    context.on("requestfinished", note)


def _describe(purpose: str, ledger: Ledger) -> None:
    if ledger.exempt_reason:
        print(f"[outbound] {purpose}: collector guard OFF — {ledger.exempt_reason}")


def guarded_context(browser, *, purpose: str, allow_collectors: str = "",
                    **context_kwargs):
    """A sync Playwright context that cannot fire a client's tracking.

    Returns `(context, ledger)`. Pass `allow_collectors="<why>"` to opt out;
    the reason is printed and recorded, and an empty string is not an opt-out.
    """
    context = browser.new_context(**context_kwargs)
    ledger = Ledger(str(allow_collectors or "").strip())
    if ledger.guarded:
        context.route(
            _refuse,
            lambda route, request, l=ledger: (
                l.blocked.append(request.url[:200]), route.abort()),
        )
    _watch_leaks(context, ledger)
    _describe(purpose, ledger)
    return context, ledger


async def guarded_context_async(browser, *, purpose: str, allow_collectors: str = "",
                                **context_kwargs):
    """The async twin of `guarded_context`, with identical rules."""
    context = await browser.new_context(**context_kwargs)
    ledger = Ledger(str(allow_collectors or "").strip())
    if ledger.guarded:
        await context.route(
            _refuse,
            lambda route, request, l=ledger: (
                l.blocked.append(request.url[:200]), route.abort()),
        )
    _watch_leaks(context, ledger)
    _describe(purpose, ledger)
    return context, ledger
