"""
Page resource extraction.

A link checker that only follows <a href> misses the failures users actually
notice: a 404 on a <script src> breaks every interaction on the page, and a
dead <link rel=stylesheet> makes it unreadable. Those are silent today — the
page still returns 200.

Pure functions over a parsed DOM. No Playwright, no network.
"""
import re
from urllib.parse import unquote, urljoin, urlparse

from models import RawLink


# ─── Resource taxonomy ───────────────────────────────────────────────────────
# Drives the "Link Types" panel. `anchor` is what the crawler already handled.
ANCHOR = "anchor"
IMAGE = "image"
SCRIPT = "script"
STYLESHEET = "stylesheet"
CSS_URL = "css_url"
IFRAME = "iframe"
MEDIA = "media"
META_IMAGE = "meta_image"
FAVICON = "favicon"
OTHER = "other"

RESOURCE_LABELS = {
    ANCHOR: "<a href>",
    IMAGE: "<img src>",
    SCRIPT: "<script src>",
    STYLESHEET: "<link stylesheet>",
    CSS_URL: "CSS url()",
    IFRAME: "iframe",
    MEDIA: "media",
    META_IMAGE: "social/meta image",
    FAVICON: "favicon",
    OTHER: "other",
}

# Why a broken resource of this type matters. Deterministic copy — no LLM.
RESOURCE_IMPACT = {
    SCRIPT: "breaks page behaviour",
    STYLESHEET: "breaks page rendering",
    IMAGE: "shows a broken image to visitors",
    CSS_URL: "a background or font asset fails to load",
    IFRAME: "an embedded panel fails to load",
    MEDIA: "audio or video fails to play",
    META_IMAGE: "link previews on social platforms break",
    FAVICON: "the browser tab icon is missing",
    OTHER: "an asset fails to load",
}

# A broken script or stylesheet stops the page working, not just looking wrong.
HIGH_PRIORITY_RESOURCES = frozenset({SCRIPT, STYLESHEET})

# Rendering breaks; these never carry meaningful anchor text.
_RESOURCE_ZONE = "Resource"

_NON_FETCHABLE = ("data:", "blob:", "javascript:", "about:", "mailto:", "tel:")

# url(...) in CSS: single, double or unquoted, ignoring data: URIs.
_CSS_URL_RE = re.compile(r"""url\(\s*(?:'([^']*)'|"([^"]*)"|([^)'"]*))\s*\)""", re.IGNORECASE)

_IMPORT_RE = re.compile(r"""@import\s+(?:url\(\s*)?(?:'([^']*)'|"([^"]*)")""", re.IGNORECASE)


# Content types that prove nothing either way. A server that does not say what
# it sent has not told us it is wrong, and octet-stream is what a great many
# CDNs send for a perfectly good image.
UNTELLING_TYPES = ("", "application/octet-stream", "binary/octet-stream")


def content_type_problem(resource_type: str, status_code, content_type):
    """An image URL that answered 2xx with something that is not an image.

    Returns (confidence, reason) or None. The classic case is a soft 404: the
    server answers 200 with its "page not found" HTML, so the link checker sees
    a healthy response and the visitor sees a broken image. Nothing here is
    ever `broken` — a Referer-checking host can serve us a page and a browser
    the picture — so it is a warning that names what actually came back, and
    the reader decides.
    """
    if resource_type != IMAGE:
        return None
    if status_code is None or not (200 <= int(status_code) < 300):
        return None                      # a 404 is already a broken image
    ctype = (content_type or "").split(";")[0].strip().lower()
    if ctype in UNTELLING_TYPES or ctype.startswith("image/"):
        return None
    if ctype.startswith("text/html") or ctype.startswith("application/xhtml"):
        return ("high", "This image URL returns a web page, not an image — usually a "
                        "\"not found\" page answering 200. The visitor sees a broken image.")
    return ("low", f"This image URL returns {ctype}, not an image. It may not render.")


def describe_resource_failure(resource_type: str) -> str:
    """Reason text for a broken resource, e.g. for a dead <script src>."""
    label = RESOURCE_LABELS.get(resource_type, RESOURCE_LABELS[OTHER])
    impact = RESOURCE_IMPACT.get(resource_type, RESOURCE_IMPACT[OTHER])
    return f"Broken {label} — {impact}"


def _is_fetchable(raw: str) -> bool:
    if not raw:
        return False
    value = raw.strip()
    if not value or value.startswith("#"):
        return False
    return not value.lower().startswith(_NON_FETCHABLE)


def _absolute(base: str, raw: str) -> str:
    return urljoin(base, raw.strip())


def parse_srcset(value: str) -> list:
    """`a.png 1x, b.png 2x` -> ['a.png', 'b.png']. Descriptors are dropped."""
    out = []
    for candidate in (value or "").split(","):
        url = candidate.strip().split()[0] if candidate.strip() else ""
        if url:
            out.append(url)
    return out


def extract_css_urls(css_text: str, base_url: str) -> list:
    """Absolute URLs referenced by url() and @import in a stylesheet."""
    found = []
    for match in _CSS_URL_RE.finditer(css_text or ""):
        raw = next((g for g in match.groups() if g is not None), "")
        if _is_fetchable(raw):
            found.append(_absolute(base_url, raw))
    for match in _IMPORT_RE.finditer(css_text or ""):
        raw = next((g for g in match.groups() if g is not None), "")
        if _is_fetchable(raw):
            found.append(_absolute(base_url, raw))
    return found


def _rels(tag) -> set:
    rel = tag.get("rel") or []
    if isinstance(rel, str):
        rel = rel.split()
    return {r.lower() for r in rel}


def _resource(url: str, page_url: str, resource_type: str, element: str) -> RawLink:
    return RawLink(
        url=url,
        source_element=element,
        anchor_text=RESOURCE_LABELS.get(resource_type, resource_type),
        category=_RESOURCE_ZONE,
        is_external=urlparse(url).netloc != urlparse(page_url).netloc,
        # Cleared by the checker if the resource turns out to be healthy.
        priority="high" if resource_type in HIGH_PRIORITY_RESOURCES else "low",
        zones=[_RESOURCE_ZONE],
        link_kind="http",
        resource_type=resource_type,
    )


_PIXEL_STYLE = re.compile(r"(?:width|height):[01](?:\.0+)?px")


def is_tracking_pixel(tag) -> bool:
    """A 1x1 or zero-sized <img>: a beacon, not something a visitor can see.

    Nothing a person is meant to look at is one pixel wide, so a broken one is
    not a broken image — and fetching it is usually the whole point of it
    existing. Attribute sizes and the inline style both count; a pixel sized
    only by an external stylesheet still reaches the beacon guard in the
    checker.
    """
    for attr in ("width", "height"):
        raw = (tag.get(attr) or "").strip().lower().removesuffix("px")
        try:
            if float(raw) <= 1:
                return True
        except ValueError:
            pass
    style = (tag.get("style") or "").lower().replace(" ", "")
    return bool(_PIXEL_STYLE.search(style))


def is_noscript(tag) -> bool:
    """Inside <noscript>: markup for browsers with JavaScript off.

    The scan renders with JavaScript on, so this never loaded for us and never
    loads for virtually any visitor. Checking it would report a fault nobody
    can see, and for the usual occupant — a pixel's fallback <img> — the check
    itself is the fault.
    """
    return tag.find_parent("noscript") is not None


def collect_resources(soup, page_url: str) -> list:
    """Every fetchable non-anchor resource the page references, deduped by URL."""
    found: dict = {}

    def add(raw: str, resource_type: str, element: str) -> None:
        if not _is_fetchable(raw):
            return
        absolute = _absolute(page_url, raw)
        if not absolute.lower().startswith(("http://", "https://")):
            return
        # First sighting wins, except that a higher-priority type upgrades the
        # row: the same URL used as both an <img> and a <script> should be
        # reported with the consequence that actually breaks the page.
        existing = found.get(absolute)
        if existing is None:
            found[absolute] = _resource(absolute, page_url, resource_type, element)
        elif (resource_type in HIGH_PRIORITY_RESOURCES
              and existing.resource_type not in HIGH_PRIORITY_RESOURCES):
            found[absolute] = _resource(absolute, page_url, resource_type, element)

    for tag in soup.find_all("img"):
        if is_noscript(tag) or is_tracking_pixel(tag):
            continue
        add(tag.get("src", ""), IMAGE, "img")
        for candidate in parse_srcset(tag.get("srcset", "")):
            add(candidate, IMAGE, "img[srcset]")

    for tag in soup.find_all("script", src=True):
        add(tag["src"], SCRIPT, "script")

    for tag in soup.find_all("link", href=True):
        rels = _rels(tag)
        if "stylesheet" in rels:
            add(tag["href"], STYLESHEET, "link[rel=stylesheet]")
        elif "icon" in rels or "shortcut" in rels or "apple-touch-icon" in rels:
            add(tag["href"], FAVICON, "link[rel=icon]")
        elif "preload" in rels and (tag.get("as") or "").lower() in {"script", "style", "font"}:
            add(tag["href"], OTHER, "link[rel=preload]")

    for tag in soup.find_all("iframe", src=True):
        add(tag["src"], IFRAME, "iframe")

    for name in ("video", "audio"):
        for tag in soup.find_all(name):
            add(tag.get("src", ""), MEDIA, name)
            add(tag.get("poster", ""), IMAGE, f"{name}[poster]")

    for tag in soup.find_all("source"):
        add(tag.get("src", ""), MEDIA, "source")
        for candidate in parse_srcset(tag.get("srcset", "")):
            add(candidate, IMAGE, "source[srcset]")

    # Social preview images. og:image uses `property`, twitter:image uses `name`.
    for tag in soup.find_all("meta"):
        key = (tag.get("property") or tag.get("name") or "").lower()
        if key in {"og:image", "og:image:url", "og:image:secure_url", "twitter:image",
                   "twitter:image:src"}:
            add(tag.get("content", ""), META_IMAGE, f"meta[{key}]")

    # CSS url() from inline <style> blocks and style="" attributes.
    for tag in soup.find_all("style"):
        for url in extract_css_urls(tag.get_text() or "", page_url):
            add(url, CSS_URL, "style")

    for tag in soup.find_all(style=True):
        for url in extract_css_urls(tag.get("style") or "", page_url):
            add(url, CSS_URL, "[style]")

    return list(found.values())


def resources_from_stylesheets(sheets: list, page_url: str) -> list:
    """RawLinks for url() references collected from linked stylesheets.

    `sheets` is [{"href": str, "text": str}] gathered at runtime — a linked
    stylesheet's rules are only readable once the browser has loaded it.
    """
    found: dict = {}
    for sheet in sheets or []:
        base = sheet.get("href") or page_url
        for url in extract_css_urls(sheet.get("text") or "", base):
            if url not in found:
                found[url] = _resource(url, page_url, CSS_URL, "stylesheet url()")
    return list(found.values())


# ─── Overview panels ─────────────────────────────────────────────────────────
def link_type_breakdown(results) -> dict:
    """Counts per resource type, for the Link Types panel."""
    counts = {}
    for r in results:
        rtype = _get(r, "resource_type") or ANCHOR
        counts[rtype] = counts.get(rtype, 0) + 1
    return counts


def scheme_breakdown(results) -> dict:
    """https / http / mailto / tel / data counts."""
    counts = {}
    for r in results:
        scheme = (urlparse(_get(r, "url") or "").scheme or "other").lower()
        counts[scheme] = counts.get(scheme, 0) + 1
    return counts


def host_breakdown(results, limit: int = 10) -> list:
    """[{host, count}] sorted by count desc, then host, for the Top Hosts panel."""
    counts = {}
    for r in results:
        host = urlparse(_get(r, "url") or "").netloc.lower()
        if not host:
            continue   # mailto:/tel: have no host
        counts[host] = counts.get(host, 0) + 1
    ranked = sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))
    return [{"host": h, "count": c} for h, c in ranked[:limit]]


def _get(result, field):
    if isinstance(result, dict):
        return result.get(field)
    return getattr(result, field, None)


# ─── Soft 404: a page that says 200 and means "gone" ────────────────────────
#
# content_type_problem above catches an IMAGE URL that answers 200 with a web
# page. This is the same failure one level up: a PAGE that answers 200 with a
# "not found". Observed on a real client site — a ClickFunnels funnel had been
# deleted, and the URL returned 200 while serving the platform's own
# nopage_error.html. Every check we run called it healthy: uptime looks for a
# status under 500, the link checker looks for a status under 400. The funnel
# had been gone for an unknown length of time.
#
# Any client page on any hosted platform can die this way. It is not a fault of
# the client's; it is a fault of ours for only ever reading the status line.

# The platform said it itself, in the URL it redirected us to. Unambiguous.
_NOT_FOUND_PATHS = (
    "nopage_error", "page-not-found", "pagenotfound", "page_not_found",
    "/404", "404.htm", "/not-found", "/notfound", "/error/404",
)

# A title is strong evidence, but only these phrasings. "Oops" and "Sorry" are
# how half the web opens a perfectly good page.
_NOT_FOUND_TITLES = (
    "page not found", "404 not found", "not found", "page doesn't exist",
    "page does not exist", "page no longer exists", "page unavailable",
    "no longer available", "nothing here", "404 error",
)

# A URL that is ABOUT errors must never be read as one.
_URL_IS_ABOUT_ERRORS = ("404", "not-found", "notfound", "error", "soft-404",
                        "broken-link", "dead-link")

_STOPWORDS = frozenset({
    "the", "and", "for", "with", "from", "this", "that", "our", "your", "you",
    "www", "com", "net", "org", "html", "htm", "php", "index", "page", "home",
    "new", "all", "how", "what", "why", "get", "top", "best", "http", "https",
})


def _title_of(html: str) -> str:
    m = re.search(r"<title[^>]*>(.*?)</title>", html or "", re.I | re.S)
    return re.sub(r"\s+", " ", m.group(1)).strip().lower() if m else ""


def _visible_text(html: str) -> str:
    """Body text without script/style, lowercased. Cheap and good enough."""
    body = re.sub(r"(?is)<(script|style|noscript)[^>]*>.*?</\1>", " ", html or "")
    return re.sub(r"\s+", " ", re.sub(r"(?s)<[^>]+>", " ", body)).strip().lower()


def slug_words(url: str) -> list:
    """The meaningful words in a URL's last path segment.

    A page about `dr-dania-alkhani` says "dania" somewhere. A platform's error
    page does not. This is corroboration only — never enough on its own, because
    plenty of real pages are images or one-word landing pages.
    """
    try:
        path = urlparse(url).path.rstrip("/")
    except Exception:
        return []
    segment = unquote(path.rsplit("/", 1)[-1]) if path else ""
    segment = re.sub(r"\.(html?|php|aspx?)$", "", segment, flags=re.I)
    words = [w for w in re.split(r"[-_+.%20\s]+", segment.lower()) if w]
    return [w for w in words if len(w) >= 4 and w not in _STOPWORDS and not w.isdigit()]


def soft_404_problem(status_code, content_type, requested_url, final_url, html):
    """A page that answered 2xx while telling the visitor it does not exist.

    Returns (confidence, reason) or None. Never `broken`: a 200 is a 200, and
    a page can legitimately be titled "Not Found" while being exactly what the
    visitor wanted. Confidence separates "the platform told us" from "this
    looks like it".
    """
    if status_code is None or not (200 <= int(status_code) < 300):
        return None                       # a real 404 is already broken
    ctype = (content_type or "").split(";")[0].strip().lower()
    if ctype and not (ctype.startswith("text/html")
                      or ctype.startswith("application/xhtml")):
        return None
    low_requested = (requested_url or "").lower()
    if any(m in low_requested for m in _URL_IS_ABOUT_ERRORS):
        return None                       # a page about 404s is not a 404

    landed = (final_url or requested_url or "").lower()
    title = _title_of(html)
    words = slug_words(requested_url)
    text = _visible_text(html)
    # Corroboration: none of the URL's own words appear on the page it served.
    slug_absent = bool(words) and not any(w in text for w in words)

    # 1. The platform redirected us to its own error page and named it.
    if any(m in landed for m in _NOT_FOUND_PATHS):
        return ("high",
                "This page answers 200 but the server sent us to its own "
                f"\"not found\" page ({landed.rsplit('/', 1)[-1] or landed}). "
                "Visitors following this link reach an error, and every status "
                "check still reports it healthy.")

    # 2. The title says it plainly.
    if any(p in title for p in _NOT_FOUND_TITLES):
        if slug_absent:
            return ("high",
                    f"This page answers 200 but its title reads \"{title[:70]}\", "
                    "and nothing from the address appears on it. The page is "
                    "almost certainly gone.")
        return ("low",
                f"This page answers 200 but its title reads \"{title[:70]}\". "
                "It may be a genuine page about errors — worth opening.")

    # 3. It left the host entirely and landed on the platform's own site.
    from watchdog import _registrable        # same host logic as the watchdog
    try:
        want, got = urlparse(requested_url).hostname, urlparse(final_url or "").hostname
    except Exception:
        want = got = None
    # A different REGISTRABLE domain. www → apex, or a subdomain moving within
    # the same site, is ordinary and must not count.
    if want and got and _registrable(want) != _registrable(got):
        if slug_absent:
            return ("low",
                    f"This page answers 200 but redirects off {want} to {got}, "
                    "and nothing from the address appears on the page that "
                    "loads. Often what a platform serves once a page is deleted.")
    return None
