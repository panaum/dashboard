"""A page that is not the client's tells us nothing about the client's page.

Both of these were observed raising a *critical* "Search visibility at risk" on
real sites on 2026-09-19:

  * shopping-protection.com answered 403 with a bot challenge, and the
    challenge page carries `noindex, nofollow`.
  * elitepractice.clickfunnels.com answered 200 but landed on ClickFunnels'
    own `nopage_error.html`, because the funnel no longer exists.

Neither response was the client's homepage. The house rule is that ambiguous
evidence warns; it never fails.
"""
import sentinel
from sentinel import _not_their_page, indexability_verdict


class Resp:
    def __init__(self, status=200, text="<html></html>", url="https://c.test/", headers=None):
        self.status_code, self.text, self.url = status, text, url
        self.headers = headers or {}


# ─── what disqualifies a response ───────────────────────────────────────────

def test_a_bot_challenge_cannot_answer_for_the_page_behind_it():
    r = Resp(403, "<title>Checking your browser before accessing. Just a moment...</title>"
                  "<meta name='robots' content='noindex, nofollow'>")
    why = _not_their_page(r)
    assert why and "403" in why


def test_a_challenge_served_with_200_is_still_a_challenge():
    r = Resp(200, "<html><body>Just a moment... verifying</body></html>")
    why = _not_their_page(r)
    assert why and "bot challenge" in why


def test_an_error_page_cannot_answer_either():
    r = Resp(200, "<title>Clickfunnels - Page Not Found</title>",
             url="https://elitepractice.clickfunnels.com/nopage_error.html")
    why = _not_their_page(r)
    assert why and "error page" in why


def test_the_clients_own_page_is_readable():
    assert _not_their_page(Resp(200, "<html><h1>Welcome</h1></html>")) is None
    # A real noindex on a real page is still a real finding.
    assert _not_their_page(
        Resp(200, "<meta name='robots' content='noindex'>")) is None


def test_a_redirect_to_a_normal_path_is_not_an_error_page():
    r = Resp(200, "<h1>Hi</h1>", url="https://c.test/en/home")
    assert _not_their_page(r) is None


# ─── and what that means for the verdict ────────────────────────────────────

def test_unreadable_directives_are_unknown_not_critical():
    v = indexability_verdict(robots_ok=True, meta_noindex=None,
                             header_noindex=None, sitemap_ok=True)
    assert v["overall"] == "unknown", "Unknown, not At risk"
    noindex = next(c for c in v["checks"] if c["key"] == "noindex")
    assert noindex["status"] == "unknown"


def test_a_genuine_noindex_is_still_critical():
    v = indexability_verdict(robots_ok=True, meta_noindex=True,
                             header_noindex=False, sitemap_ok=True)
    assert v["overall"] == "critical"


def test_the_disqualifier_never_raises_on_an_odd_response():
    class Odd:
        status_code = 200
        url = "https://c.test/"
        headers = {}
        @property
        def text(self):
            raise ValueError("decoding blew up")
    assert _not_their_page(Odd()) is None
