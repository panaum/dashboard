"""The requests the scan refuses to make.

A Meta Pixel's <noscript> fallback is an <img> pointing at a collection
endpoint. Collect it, hand it to the checker, and the checker GETs it with a
browser user-agent and the client's own page as Referer — which is a PageView,
recorded in the client's reporting, caused by their QA tool. These tests pin
both halves of the guard: the beacon never reaches the checker, and if it ever
does, the checker declines it.
"""
import asyncio

import pytest
from bs4 import BeautifulSoup

from beacons import beacon_reason
from checker import bucket_for_label, check_single
from models import RawLink
from resources import IMAGE, collect_resources

PAGE = "https://client.com/"
META_PIXEL = "https://www.facebook.com/tr?id=1234567890&ev=PageView&noscript=1"


# ─── what we refuse ─────────────────────────────────────────────────────────

def test_the_meta_pixel_noscript_beacon_is_refused():
    assert beacon_reason(META_PIXEL) is not None


def test_collection_endpoints_are_refused():
    for url in ("https://www.google-analytics.com/g/collect?v=2&tid=G-X",
                "https://www.google-analytics.com/collect?v=1&tid=UA-X",
                "https://px.ads.linkedin.com/collect?pid=1",
                "https://www.clarity.ms/collect",
                "https://analytics.tiktok.com/api/v2/pixel",
                "https://bat.bing.com/action/0?ti=1"):
        assert beacon_reason(url) is not None, url


def test_a_collector_on_the_clients_own_domain_is_still_a_collector():
    # Self-hosted Matomo, or a first-party proxy in front of GA4. The host
    # tells us nothing; the endpoint does.
    assert beacon_reason("https://client.com/stats/matomo.php?idsite=1")
    assert beacon_reason("https://client.com/piwik.php")
    assert beacon_reason("https://metrics.client.com/g/collect?v=2")


# ─── what we must keep checking ─────────────────────────────────────────────

def test_a_link_to_the_clients_own_facebook_page_is_still_checked():
    # The scraper's render-time list matches "facebook.com" loosely, which is
    # right for a browser subresource and wrong here: this is an ordinary
    # footer link, and refusing it would silently drop real coverage.
    assert beacon_reason("https://www.facebook.com/apexure") is None
    assert beacon_reason("https://www.facebook.com/groups/some-group") is None


def test_tag_scripts_are_still_checked():
    # Fetching JavaScript records nothing, and a tag container that 404s means
    # the client's analytics is not running at all — a finding worth having.
    for url in ("https://www.googletagmanager.com/gtm.js?id=GTM-ABC",
                "https://www.googletagmanager.com/gtag/js?id=G-ABC",
                "https://connect.facebook.net/en_US/fbevents.js",
                "https://www.clarity.ms/tag/abcdef",
                "https://static.hotjar.com/c/hotjar-123.js?sv=6"):
        assert beacon_reason(url) is None, url


def test_an_ordinary_page_whose_path_merely_reads_like_tracking():
    for url in ("https://client.com/tracking-your-order",
                "https://client.com/blog/why-we-left-matomo",
                "https://client.com/collections/shoes"):
        assert beacon_reason(url) is None, url


def test_non_http_targets_are_not_this_guards_business():
    for url in ("mailto:hi@client.com", "tel:+123", "#top", "", None):
        assert beacon_reason(url) is None, repr(url)


# ─── the checker declines rather than reporting a result it did not get ─────

class _ExplodingClient:
    """Any request at all is the bug this whole module exists to prevent."""
    async def get(self, *a, **kw):
        raise AssertionError(f"the scan requested a beacon: {a} {kw}")


def test_the_checker_never_requests_a_beacon_and_says_so():
    link = RawLink(url=META_PIXEL, source_url=PAGE, link_kind="http",
                   resource_type=IMAGE, anchor_text="", category="Resource",
                   source_element="img", is_external=True)
    result = asyncio.run(check_single(_ExplodingClient(), link))

    assert result.label == "not_requested"
    assert result.bucket == "unverifiable", "not ok — we did not check it"
    assert result.status_code is None
    assert "record a visit that never happened" in (result.error or "")
    assert result.reason == result.error


def test_the_refusal_label_is_an_honest_third_state():
    # Distinct from "blocked" (their host refused us) and from "ok" (we looked
    # and it was fine). Neither of those is true here.
    assert bucket_for_label("not_requested") == "unverifiable"
    assert bucket_for_label("not_requested") != bucket_for_label("ok")


# ─── and the beacon should never get that far ───────────────────────────────

def _images(html):
    rows = collect_resources(BeautifulSoup(html, "lxml"), PAGE)
    return {r.url for r in rows if r.resource_type == IMAGE}


def test_an_image_inside_noscript_is_not_collected():
    html = f'<html><body><noscript><img src="{META_PIXEL}" height="1" width="1">' \
           '</noscript><img src="/hero.png"></body></html>'
    assert _images(html) == {"https://client.com/hero.png"}


def test_a_one_pixel_image_is_not_collected_however_it_is_sized():
    html = ('<html><body>'
            '<img src="/attr.gif" width="1" height="1">'
            '<img src="/zero.gif" width="0" height="0">'
            '<img src="/styled.gif" style="width: 1px; height: 1px">'
            '<img src="/real.jpg" width="800" height="600">'
            '<img src="/unsized.png">'
            '</body></html>')
    assert _images(html) == {"https://client.com/real.jpg",
                             "https://client.com/unsized.png"}


def test_a_pixels_srcset_goes_with_it():
    html = '<html><body><img src="/p.gif" srcset="/p2.gif 2x" width="1" height="1">' \
           '</body></html>'
    assert _images(html) == set()


def test_odd_sizes_never_crash_the_collector():
    html = ('<html><body>'
            '<img src="/a.png" width="100%" height="auto">'
            '<img src="/b.png" width="" height="  ">'
            '<img src="/c.png" width="320px">'
            '</body></html>')
    assert _images(html) == {"https://client.com/a.png", "https://client.com/b.png",
                             "https://client.com/c.png"}
