"""A page that answers 200 and means "gone".

Found on a real client site: a ClickFunnels funnel had been deleted, and the
URL answered 200 while serving the platform's own nopage_error.html. Uptime
looks for a status under 500 and the link checker for one under 400, so it
passed both while showing visitors an error. Nobody knows how long for.

The rule is the same as every other check here: never `broken` — a 200 is a
200, and a page can legitimately be titled "Not Found" while being exactly what
the visitor wanted. Confidence separates "the platform told us" from "this
looks like it".
"""
from resources import slug_words, soft_404_problem

HTML = "<title>{t}</title><body>{b}</body>"


def p(requested, final=None, title="Welcome", body="Hello there",
      status=200, ctype="text/html; charset=utf-8"):
    return soft_404_problem(status, ctype, requested, final or requested,
                            HTML.format(t=title, b=body))


# ─── the case that started it ───────────────────────────────────────────────

def test_the_platform_naming_its_own_error_page_is_high_confidence():
    got = p("https://elitepractice.clickfunnels.com/dr-dania-alkhani",
            "https://elitepractice.clickfunnels.com/nopage_error.html",
            title="Clickfunnels - Page Not Found",
            body="The page you requested was not found.")
    assert got and got[0] == "high"
    assert "answers 200" in got[1] and "not found" in got[1].lower()
    assert "still reports it healthy" in got[1], "it says why nothing caught it"


def test_a_title_that_says_it_plainly_with_nothing_from_the_address_on_the_page():
    got = p("https://acme.com/dr-dania-alkhani", title="Page not found",
            body="Sorry, we could not find what you were looking for.")
    assert got and got[0] == "high"


def test_the_same_title_on_a_page_that_matches_its_address_is_only_low():
    # It may genuinely be a page about errors. Worth opening, not worth alarm.
    got = p("https://acme.com/dania-alkhani", title="Page not found",
            body="Dania Alkhani's page has moved, see below.")
    assert got and got[0] == "low"


# ─── what must never be flagged ─────────────────────────────────────────────

def test_a_real_page_is_never_flagged():
    assert p("https://acme.com/dr-dania-alkhani", title="Dr Dania Alkhani",
             body="Dania Alkhani is a dentist in Dubai.") is None


def test_an_article_about_404s_is_not_a_404():
    assert p("https://acme.com/blog/how-to-fix-404-errors",
             title="How to fix 404 not found errors",
             body="404 errors happen when a page is removed.") is None
    assert p("https://acme.com/page-not-found", title="Page not found") is None


def test_a_real_404_status_is_already_broken_and_not_our_business():
    for status in (404, 410, 500):
        assert p("https://acme.com/gone", title="Page not found", status=status) is None


def test_non_html_is_not_a_page():
    assert p("https://acme.com/a.png", title="Page not found", ctype="image/png") is None
    assert p("https://acme.com/f.pdf", title="Not found", ctype="application/pdf") is None


def test_ordinary_redirects_are_ordinary():
    # www → apex, and a subdomain moving inside the same site.
    assert p("https://www.acme.com/spring-promo", "https://acme.com/spring-promo",
             title="Spring Promo", body="Our spring promo is here") is None
    assert p("https://shop.acme.com/widgets", "https://acme.com/shop/widgets",
             title="Widgets", body="Buy widgets today") is None


def test_going_offsite_only_counts_when_the_content_does_not_match():
    # A syndicated page that keeps its content is fine.
    assert p("https://client.com/spring-promo", "https://partner.com/spring-promo",
             title="Spring Promo", body="The spring promo page") is None
    # The platform's own marketing site, with nothing of the address on it.
    got = p("https://client.com/promo-spring",
            "https://clickfunnels.com/?utm_campaign=domain_redirect",
            title="ClickFunnels - Marketing Funnels", body="Build funnels fast")
    assert got and got[0] == "low", "suggestive, not proven"


# ─── the corroborating signal ───────────────────────────────────────────────

def test_slug_words_are_the_words_worth_looking_for():
    assert slug_words("https://acme.com/dr-dania-alkhani") == ["dania", "alkhani"]
    assert slug_words("https://acme.com/blog/spring_promo_2026.html") == ["spring", "promo"]
    # Nothing meaningful to look for: no corroboration is available.
    assert slug_words("https://acme.com/") == []
    assert slug_words("https://acme.com/index.html") == []
    assert slug_words("https://acme.com/a/b") == []


def test_percent_encoding_does_not_hide_the_words():
    assert "dania" in slug_words("https://acme.com/dr%2Ddania%2Dalkhani")


def test_nothing_crashes_on_junk():
    for bad in (None, "", "not a url", "https://", "mailto:x@y.z"):
        assert soft_404_problem(200, "text/html", bad, bad, "<html></html>") is None
        assert isinstance(slug_words(bad), list)
