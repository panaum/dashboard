"""
Requests we refuse to make.

The crawler already refuses analytics during a render: `_block_non_get` aborts
them inside the browser, because firing a pixel or pressing a CTA while we
audit would log a visitor who does not exist. That guard stops at the browser.

Everything `collect_resources` finds is then handed to the checker, which GETs
it. So a Meta Pixel's <noscript> fallback — `<img src=".../tr?id=...&
ev=PageView&noscript=1">` — was fetched on every scan, from a browser-shaped
request carrying the client's own page as Referer. That is a PageView written
into the client's reporting by their QA tool, once per scan, per page.

This is the same refusal moved to the other choke point: the checker's GET.

Deliberately NOT the scraper's list. That one matches loosely against the whole
URL because anything the browser requests in page context counts as a hit, and
a needless block costs nothing. The checker also sees <a href> links, where a
needless refusal costs real coverage: a client's footer link to their own
Facebook page must still be checked. So hosts are matched against the host, and
the two entries that are a path are matched against host plus path.

Fail closed, but narrowly. On a host whose business is recording hits, anything
that is not a static asset is assumed to record one. Their tag SCRIPT is still
checked — a container that 404s is a real finding, and fetching a .js file
counts nothing — while their collector endpoints are never requested. The cost
of refusing wrongly is one link reported as "not checked", which is honest. The
cost of fetching wrongly is a number in a client's dashboard that no human can
explain.
"""
from urllib.parse import urlsplit


# Hosts that exist to record hits. Matched against the host only.
BEACON_HOSTS = (
    "google-analytics.com", "analytics.google.com", "googletagmanager.com",
    "doubleclick.net", "googleadservices.com", "googlesyndication.com",
    "connect.facebook.net", "segment.io", "segment.com",
    "mixpanel.com", "amplitude.com", "hotjar.com", "hotjar.io",
    "clarity.ms", "fullstory.com", "logrocket.io", "logrocket.com",
    "analytics.tiktok.com", "ads.linkedin.com", "snap.licdn.com",
    "bat.bing.com", "plausible.io", "posthog.com", "heapanalytics.com",
    "track.hubspot.com", "hs-analytics.net",
    "matomo.cloud", "ct.pinterest.com", "analytics.twitter.com",
    "static.ads-twitter.com",
)

# Matched against host + path, because the bare host is a normal destination a
# client legitimately links to and we must keep checking.
BEACON_URLS = (
    "facebook.com/tr",
    "leadconnectorhq.com/tracking",
    "msgsndr.com/tracking",
)

# Endpoints that record a hit whoever serves them: self-hosted Matomo, a
# first-party proxy in front of GA4, a CNAME-cloaked pixel on the client's own
# domain. Unambiguous paths only — a page at /tracking-your-order is not one.
COLLECTOR_PATHS = (
    "/matomo.php", "/piwik.php",
    "/g/collect", "/j/collect", "/r/collect", "/mp/collect",
    # Google's consent-mode collectors, served from www.google.com itself —
    # so the host tells us nothing and only the path does. Measured firing on
    # a real client render, twice per page load.
    "/ccm/collect", "/ccm/s/collect",
    "/ads/ga-audiences",
    "/i/adsct",
)

# Fetching one of these counts nothing, so it stays checkable even on a beacon
# host. Note .gif is absent on purpose: a 1x1 .gif on an analytics host is the
# oldest beacon there is.
STATIC_SUFFIXES = (
    ".js", ".mjs", ".css", ".map",
    ".woff", ".woff2", ".ttf", ".otf", ".eot",
    ".png", ".jpg", ".jpeg", ".webp", ".svg", ".ico",
)

# Loader scripts whose path carries no extension. Google's gtag and Microsoft
# Clarity both serve JavaScript from an extensionless path, and a 404 on either
# means the client's tag is not loading at all — which we want to catch.
SCRIPT_PATHS = ("/gtag/js", "/tag/")


def beacon_reason(url: str):
    """Why we will not request this URL, or None when it is safe to fetch.

    The string is shown to the client, so it says what we did and why, not
    which rule matched.
    """
    low = (url or "").strip().lower()
    if not low.startswith(("http://", "https://")):
        return None

    parts = urlsplit(low)
    host = parts.hostname or ""
    host_path = host + parts.path

    for path in COLLECTOR_PATHS:
        if parts.path.endswith(path) or path in parts.path:
            return ("Not requested: this is an analytics collection endpoint, "
                    "and fetching it would record a visit that never happened.")

    on_beacon_host = (
        any(host == h or host.endswith("." + h) for h in BEACON_HOSTS)
        or any(token in host_path for token in BEACON_URLS)
    )
    if not on_beacon_host:
        return None

    if parts.path.endswith(STATIC_SUFFIXES):
        return None
    if any(p in parts.path for p in SCRIPT_PATHS):
        return None

    return ("Not requested: this is a tracking endpoint, and fetching it would "
            "record a visit that never happened. Its script is still checked.")
