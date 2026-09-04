#!/usr/bin/env python3
"""Pagecheck — Phase 1 engine.

Answers one question about a landing page: will it capture a lead *and* the
attribution that lead arrived with?

Three rules shape every line below.
  1. Never pollute client analytics. Collector endpoints are aborted at the
     route level; tags are read from source and dataLayer, never by letting
     them fire. `collector_hits` in the JSON is the proof — it must be empty.
  2. Never submit a form. Everything here reads.
  3. Never report a false FAIL. Blocked, timed out, and no-form-on-page are
     each their own outcome. A wrong FAIL costs more than a missed issue.

Usage: pagecheck <url> [url ...] [-f urls.txt] [--json]     exit 1 on any FAIL
"""
from __future__ import annotations

import argparse, json, re, sys, time
from pathlib import Path
from datetime import datetime, timezone
from urllib.parse import urljoin, urlparse, urlencode, urlsplit, parse_qsl, urlunsplit

from playwright.sync_api import Error as PWError, TimeoutError as PWTimeout, sync_playwright

UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) "
      "Chrome/124.0.0.0 Safari/537.36 Pagecheck/0.1 (+https://apexure.com; read-only QA)")

TEST_PARAMS = {"utm_source": "qa", "utm_medium": "qa", "utm_campaign": "qa", "utm_term": "qa",
               "utm_content": "qa", "gclid": "QA_TEST_GCLID", "fbclid": "QA_TEST_FBCLID"}
ATTR_KEYS = tuple(TEST_PARAMS)

# Data-receiving endpoints, aborted before they leave the browser. Library
# scripts (fbevents.js, recaptcha) are deliberately absent — we need those to
# load so their IDs and site keys are readable from the page.
COLLECTORS = ("google-analytics.com", "analytics.google.com", "/g/collect", "/j/collect",
              "googletagmanager.com/gtag", "/gtag/js", "facebook.com/tr", "doubleclick.net/",
              "googleads.g.doubleclick.net", "google.com/ads/ga-audiences", "/ccm/collect",
              "/ccm/s/collect", "bat.bing.com", "px.ads.linkedin.com", "analytics.tiktok.com",
              "ct.pinterest.com", "t.co/i/adsct", "clarity.ms/collect", "hotjar.com",
              "mixpanel.com/track", "api.segment.io", "track.hubspot.com", "hs-analytics.net",
              "plausible.io/api/event", "matomo.php", "piwik.php")
# Only collector URLs are intercepted. An earlier version routed **/* and called
# continue_() on everything, which raced navigations and produced ERR_ABORTED on
# scripts that had loaded fine — the tool inventing the failure it then reported.
COLLECTOR_RX = re.compile("|".join(re.escape(p) for p in COLLECTORS))

# A frame with no URL has no execution context and never will: evaluate() on one
# blocks forever, with no timeout to save you. Widget frames hold no client form.
SKIP_FRAMES = ("google.com/recaptcha", "gstatic.com/recaptcha", "hcaptcha.com",
               "challenges.cloudflare.com", "doubleclick", "facebook.com/plugins",
               "youtube.com/embed", "player.vimeo.com", "googletagmanager.com",
               "google.com/maps", "connect.facebook.net",
               # Payment widgets. Their iframes hold card number / expiry / CVC and
               # can never carry attribution, but they were counted as four extra
               # "forms" and four endpoint rows on a checkout page.
               "js.stripe.com", "stripecdn.com", "paypal.com", "paypalobjects.com",
               "braintree", "adyen.com", "squareup.com", "checkout.com")

PLATFORMS = (("Unbounce", ("unbounce.com", "ub-content", "ubembed", "unbouncepages.com")),
             ("ClickFunnels", ("clickfunnels.com", "cf-section", "cfstyle", "myclickfunnels.com")),
             ("GoHighLevel", ("leadconnectorhq", "msgsndr", "app.gohighlevel.com")),
             ("Kajabi", ("kajabi", "kjb-")),   # kajabi-cdn.com, kajabi-app-assets, kajabi.com
             ("HubSpot", ("hs-scripts.com", "hsforms.net", "hubspot.com/", "hs-banner")),
             ("Framer", ("framerusercontent.com", "framer.com/m/", "__framer")),
             ("Astro", ("astro-island", "astro-slot", "data-astro-", "_astro/")),
             ("Webflow", ("webflow.com", "w-form", "wf-form")),
             ("WordPress", ("wp-content", "wp-includes", "wp-json")))
WP_FORMS = (("Gravity Forms", ("gform_", "gravityforms")), ("WPForms", ("wpforms-", "wpforms.com")),
            ("Elementor", ("elementor-form", "elementor-field")),
            ("Contact Form 7", ("wpcf7", "contact-form-7")),
            ("Ninja Forms", ("nf-form", "ninja-forms")))
CAPTCHAS = (("reCAPTCHA", ("google.com/recaptcha/api.js", "grecaptcha")),
            ("hCaptcha", ("hcaptcha.com/1/api.js", "hcaptcha.render")),
            ("Turnstile", ("challenges.cloudflare.com/turnstile", "cf-turnstile")))
# A captcha injected at runtime leaves no marker in source but always leaves its
# response field on the form. Missing this reported "no captcha" on a page whose
# form carried cf-turnstile-response.
CAPTCHA_FIELDS = {"cf-turnstile-response": "Turnstile", "g-recaptcha-response": "reCAPTCHA",
                  "h-captcha-response": "hCaptcha"}
CAPTCHA_HOSTS = ("google.com/recaptcha", "hcaptcha.com", "challenges.cloudflare.com/turnstile")
# A captcha loaded at runtime appears in neither page source nor form fields —
# only on the network. Without this the tool reported "no captcha detected" on a
# page that was plainly talking to hcaptcha.com.
CAPTCHA_BY_HOST = (("reCAPTCHA", "google.com/recaptcha"), ("reCAPTCHA", "gstatic.com/recaptcha"),
                   ("hCaptcha", "hcaptcha.com"), ("Turnstile", "challenges.cloudflare.com"))
# A honeypot is anti-spam too. Without these, two client pages that both defend
# their forms were told "no captcha — expect form spam".
HONEYPOT = ("honeypot", "hp_", "gotcha", "botcheck", "leaveblank", "leave_blank")
# A site search box is not a lead form. Counting it as one inflated the form
# count and dragged search-only pages into the attribution verdict.
SEARCH_NAMES = {"s", "q", "search", "query", "keyword", "keywords", "term"}
# ERR_ABORTED is ambiguous — a navigation or teardown produces it too — so it
# never escalates to FAIL alone. Only a hard transport failure does.
HARD_FAIL = ("ERR_NAME_NOT_RESOLVED", "ERR_CONNECTION", "ERR_CERT", "HTTP 4", "HTTP 5")
# Matched against hostname LABELS, not as substrings. Substring matching flagged
# "cdn.x.com/latest.min.js" (contains "test.") and would have failed any
# GoHighLevel /preview/ URL, where "preview" is a path segment and harmless.
NONPROD_LABEL = re.compile(
    r"^(staging|stage|stg|dev|develop|test|testing|qa|uat|sandbox|sbx|preview|demo|local)\d*$")
NONPROD_HOSTS = ("localhost", "127.0.0.1", ".local", "ngrok")
# Builder-generated domains. A page served from one is a preview or an unmapped
# build, not the client's live page — so calling a QA backend from it is very
# probably intentional, and must not be reported with the same confidence.
PREVIEW_DOMAINS = (".framer.app", ".webflow.io", ".unbouncepages.com", ".myshopify.com",
                   ".mykajabi.com", ".hubspotpagebuilder.com", ".wixsite.com", ".pages.dev",
                   ".vercel.app", ".netlify.app", ".squarespace.com", ".clickfunnels.com",
                   ".leadconnectorhq.com", ".github.io")
PLACEHOLDERS = (r"lorem ipsum", r"headline here", r"your (?:headline|text|title|content) here",
                r"sample text", r"insert (?:text|copy) here", r"placeholder text", r"\bTODO\b",
                r"\bFIXME\b", r"\btest@\w", r"@example\.com", r"\b555-?01\d{2}\b",
                r"\b555-555-?\d{4}\b")

# ── page-side JS ────────────────────────────────────────────────────────────
# One evaluate() per concern. Chatty per-element locator calls are what made an
# earlier version hang on large pages.

FORMS_JS = """() => {
  const vis = el => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
  const field = el => ({ name: el.name || el.id || '', type: (el.type || el.tagName || '').toLowerCase(),
    hidden: el.type === 'hidden' || !vis(el),
    value: typeof el.value === 'string' ? el.value.slice(0, 300) : '' });
  const sel = 'input, select, textarea';
  const forms = [...document.querySelectorAll('form')].map((f, i) => ({
    index: i, action: f.getAttribute('action'), method: (f.method || 'get').toLowerCase(),
    id: f.id || '', orphan: false, fields: [...f.querySelectorAll(sel)].map(field) }));
  // ClickFunnels and some SPA builders keep inputs outside any <form> and submit
  // by handler. Those fields still carry the attribution, so report them too.
  const loose = [...document.querySelectorAll(sel)].filter(e => !e.closest('form'));
  if (loose.length) forms.push({ index: forms.length, action: null, method: '', id: '',
    orphan: true, fields: loose.map(field) });
  return forms;
}"""

SOURCE_JS = """() => {
  const scripts = [...document.querySelectorAll('script')];
  let inline = '';
  for (const s of scripts) if (!s.src) { inline += '\\n' + (s.textContent || '');
    if (inline.length > 300000) break; }
  let dl = ''; try { dl = JSON.stringify(window.dataLayer || []).slice(0, 100000); } catch (e) {}
  return { scripts: scripts.map(s => s.src).filter(Boolean).slice(0, 400),
    inline: inline.slice(0, 300000), dataLayer: dl,
    sitekeys: [...document.querySelectorAll('[data-sitekey], [data-site-key]')]
      .map(e => e.getAttribute('data-sitekey') || e.getAttribute('data-site-key')).filter(Boolean),
    robots: [...document.querySelectorAll('meta[name="robots"], meta[name="googlebot"]')]
      .map(m => m.content || '').join(', '),
    title: (document.title || '').slice(0, 200) };
}"""

LINKS_JS = """() => [...document.querySelectorAll('a[href]')].map(a => a.href)
  .filter(h => /^https?:/i.test(h)).slice(0, 400)"""

STORAGE_JS = """() => {
  const grab = s => { const o = {}; try { for (let i = 0; i < s.length; i++) {
    const k = s.key(i); o[k] = (s.getItem(k) || '').slice(0, 500); } } catch (e) {} return o; };
  return { local: grab(localStorage), session: grab(sessionStorage) };
}"""

TEXT_JS = """() => {
  const shown = document.body ? (document.body.innerText || '').slice(0, 200000) : '';
  let hidden = '';   // placeholder copy hides in display:none blocks more often than in view
  for (const el of document.querySelectorAll(
      '[style*="display:none"], [style*="display: none"], [hidden], .hidden')) {
    hidden += '\\n' + (el.textContent || '').slice(0, 2000);
    if (hidden.length > 50000) break; }
  return { shown, hidden };
}"""

# The button must sit inside something identifying itself as a consent banner.
# Matching on button text alone clicked a form's "Continue →" and then reported
# a consent result for a page that has no banner at all.
ACCEPT_JS = """() => {
  const CTX = /(cookie|consent|gdpr|ccpa|\\bcmp\\b|onetrust|termly|cookiebot|cky-|osano|iubenda|didomi|usercentrics|klaro|cookiealert|privacy-banner)/i;
  const TXT = /^(accept|allow|agree|i agree|i accept|got it|understood|ok|okay|yes)\\b/i;
  const inBanner = el => { let n = el;
    for (let i = 0; i < 8 && n; i++, n = n.parentElement) {
      const s = (n.id || '') + ' ' + (typeof n.className === 'string' ? n.className : '') + ' '
        + (n.getAttribute ? (n.getAttribute('aria-label') || '') : '');
      if (CTX.test(s)) return true; }
    return false; };
  for (const n of document.querySelectorAll(
      'button, a[role="button"], [role="button"], input[type="button"], input[type="submit"], a')) {
    const t = ((n.innerText || n.value || n.getAttribute('aria-label') || '') + '').trim();
    if (t && t.length < 40 && TXT.test(t) && inBanner(n)) { n.click(); return t; } }
  return null;
}"""


# ── helpers ─────────────────────────────────────────────────────────────────

def _norm(s: str) -> str:
    return re.sub(r"[^a-z0-9]", "", (s or "").lower())


# Two-label public suffixes common to Apexure's clients. Comparing full
# hostnames made every Kajabi/HubSpot custom subdomain (academy.client.com) look
# like a third-party collector.
_SLD = ("co.uk", "com.au", "co.nz", "co.in", "com.br", "co.za", "com.sg")


def _nonprod_host(host: str) -> bool:
    h = (host or "").lower().split(":")[0]
    return (any(m in h for m in NONPROD_HOSTS)
            or any(NONPROD_LABEL.match(lbl) for lbl in h.split(".")))


def _registrable(host: str) -> str:
    host = (host or "").lower().split(":")[0]
    parts = host.split(".")
    n = 3 if any(host.endswith("." + s) for s in _SLD) else 2
    return ".".join(parts[-n:]) if len(parts) >= n else host


def with_params(url: str) -> str:
    p = urlsplit(url if "://" in url else "https://" + url)
    q = dict(parse_qsl(p.query, keep_blank_values=True))
    q.update(TEST_PARAMS)
    return urlunsplit((p.scheme, p.netloc, p.path or "/", urlencode(q), p.fragment))


def _frames(page):
    for f in page.frames:
        u = f.url or ""
        if f is page.main_frame:
            yield f
        elif u and u != "about:blank" and not any(h in u for h in SKIP_FRAMES):
            yield f


def _eval(frame, js, default, arg=None):
    """`arg` is passed through to the page function. Omitting it silently gave
    RESPONSIVE_JS an undefined viewport width, turning every `right <= vw`
    comparison into a NaN test that is always false."""
    try:
        return frame.evaluate(js, arg)
    except (PWError, PWTimeout):
        return default


def _collect_forms(page):
    """Every form, including inside cross-origin frames. Those frames are the
    whole reason this is Playwright and not curl: a GoHighLevel form lives in
    one and is invisible to page-source scraping."""
    out = []
    for f in _frames(page):
        for form in _eval(f, FORMS_JS, []) or []:
            form["frame"] = "main" if f is page.main_frame else (f.url or "")[:200]
            out.append(form)
    return out


SENTINELS = {"QA_TEST_GCLID": "gclid", "QA_TEST_FBCLID": "fbclid"}


# Where a page with no form of its own sends people to convert. A quote page
# whose only CTA is a booking widget still has an attribution story, and if the
# link drops the parameters the campaign dies at that hop — invisible to any
# check that only inspects forms on the page itself.
BOOKING_HOSTS = ("leadconnectorhq", "msgsndr", "calendly.com", "meetings.hubspot", "typeform.com",
                 "jotform", "acuityscheduling", "cal.com", "youcanbook.me", "hsforms",
                 "formstack", "wufoo", "gravityforms.io", "tally.so")
HANDOFF_RX = re.compile(
    r"(widget|booking|book-|/book|quote|calendar|appoint|schedule|apply|signup|sign-up|"
    r"register|get-started|consultation|estimate)", re.I)


def _handoffs(links, page_url: str):
    """Off-page conversion destinations, and whether each carries attribution."""
    base = urlsplit(page_url)
    here = (base.netloc, base.path.rstrip("/"))
    out = []
    for h in dict.fromkeys(links or []):
        p = urlsplit(h)
        if (p.netloc, p.path.rstrip("/")) == here:
            continue                      # a link back to this same page
        if HANDOFF_RX.search(p.path) or any(b in p.netloc for b in BOOKING_HOSTS):
            q = p.query.lower()
            out.append((h, any(k in q for k in ("utm_", "gclid", "fbclid"))))
    return out[:10]


def _is_search(form) -> bool:
    named = [fl for fl in form.get("fields", []) if fl.get("name")]
    return bool(named) and len(named) <= 2 and all(
        fl.get("type") == "search" or (fl.get("name") or "").lower() in SEARCH_NAMES
        for fl in named)


def _attr_fields(forms):
    """Attribution fields, keyed by param, plus fields identified only by value.

    Name matching alone is not enough: Gravity Forms renames every field to
    input_29, input_30 … so a page that captures all five UTMs and the gclid
    looks, by name, like a page that captures nothing. That produced a false
    verdict on a working page. So a field is also attribution if it *holds* one
    of the test sentinels. The gclid/fbclid sentinels are unique and map exactly;
    all five UTMs share the value "qa" by spec, so a value-matched UTM field can
    be counted but not attributed to a specific param — reported as such rather
    than guessed."""
    found, anon = {}, []
    for form in forms:
        for fl in form.get("fields", []):
            n, v = _norm(fl.get("name")), (fl.get("value") or "").strip()
            key = next((k for k in ATTR_KEYS if n and _norm(k) in n), None)
            if key:
                found.setdefault(key, []).append(fl)
            elif v in SENTINELS:
                found.setdefault(SENTINELS[v], []).append(fl)
            elif v == "qa" and (fl.get("type") == "hidden" or fl.get("hidden")):
                anon.append(fl)
    return found, anon


# ── one browser pass ────────────────────────────────────────────────────────

def run_pass(browser, url: str, accept_consent: bool) -> dict:
    """Load the page once and read everything. `accept_consent` decides whether
    the cookie banner is clicked; the caller runs this twice and diffs."""
    r = {"accepted_consent": accept_consent, "consent_button": None, "outcome": "ok",
         "status": None, "error": None, "final_url": None, "blocked_collectors": [],
         "collector_hits": [], "failed_requests": [], "console_errors": [], "mixed_content": [],
         "forms_t0": [], "forms_t3": [], "source": {}, "storage": {}, "text": {}, "cookies": [],
         "x_robots": None, "elapsed": 0.0, "nonprod_requests": set(), "captcha_seen": set(),
         "links": []}
    ctx = browser.new_context(user_agent=UA, viewport={"width": 1366, "height": 900}, locale="en-AU")
    ctx.set_default_timeout(20000)
    page = ctx.new_page()
    blocked: set[str] = set()
    insecure: set[str] = set()

    def route(rt, req):
        blocked.add(req.url)
        r["blocked_collectors"].append(req.url[:300])
        try:
            rt.abort()
        except PWError:
            pass

    ctx.route(COLLECTOR_RX, route)

    def on_request(req):
        if req.url.startswith("http://"):
            insecure.add(req.url)
        # A live page calling a QA or staging host is a real defect, and it does
        # not need a form to happen — so this is watched at the network level,
        # not only on form actions.
        if _nonprod_host(urlparse(req.url).netloc):
            r["nonprod_requests"].add(req.url[:200])
        for name, h in CAPTCHA_BY_HOST:
            if h in req.url:
                r["captcha_seen"].add(name)

    def on_finished(req):
        # Proof of the non-negotiable: anything that COMPLETED and matches a
        # collector pattern is a violation, surfaced as a FAIL in the report.
        if COLLECTOR_RX.search(req.url):
            r["collector_hits"].append(req.url[:300])

    def on_failed(req):
        if req.url not in blocked:
            r["failed_requests"].append({"url": req.url[:300], "why": (req.failure or "")[:120],
                                         "type": req.resource_type})

    def on_response(resp):
        if resp.status >= 400 and resp.url not in blocked:
            r["failed_requests"].append({"url": resp.url[:300], "why": f"HTTP {resp.status}",
                                         "type": resp.request.resource_type})

    def on_console(msg):
        if msg.type != "error":
            return
        at = (msg.location or {}).get("url") or ""
        # Our own aborts surface as console errors. Reporting them back as the
        # page's problems would be evidence we manufactured ourselves.
        if COLLECTOR_RX.search(at) or COLLECTOR_RX.search(msg.text or ""):
            return
        e = {"text": (msg.text or "")[:300],
             "at": f"{at[:200]}:{(msg.location or {}).get('lineNumber', '')}"}
        if e not in r["console_errors"]:   # the same error repeated is one fact
            r["console_errors"].append(e)

    for ev, fn in (("request", on_request), ("requestfinished", on_finished),
                   ("requestfailed", on_failed), ("response", on_response), ("console", on_console)):
        page.on(ev, fn)

    started = time.time()
    try:
        resp = page.goto(with_params(url), wait_until="domcontentloaded", timeout=35000)
        if resp is not None:
            r["status"], r["x_robots"] = resp.status, resp.header_value("x-robots-tag")
        try:
            page.wait_for_load_state("networkidle", timeout=12000)
        except PWTimeout:
            pass  # a page that polls never idles; not an error
        r["final_url"] = page.url
        src = _eval(page.main_frame, SOURCE_JS, {}) or {}
        title = (src.get("title") or "").lower()
        if r["status"] in (401, 403, 429, 503) or any(
                m in title for m in ("just a moment", "attention required", "access denied")):
            r["outcome"] = "blocked"

        if accept_consent:
            for f in _frames(page):
                clicked = _eval(f, ACCEPT_JS, None)
                if clicked:
                    r["consent_button"] = clicked
                    break
            if r["consent_button"]:
                page.wait_for_timeout(2000)

        r["forms_t0"] = _collect_forms(page)
        # A second read after 3s separates "never populates" from "populates too
        # late" — a real distinction, because fast submitters lose the data.
        page.wait_for_timeout(3000)
        r["forms_t3"] = _collect_forms(page)
        r["source"] = _eval(page.main_frame, SOURCE_JS, {}) or src
        r["links"] = _eval(page.main_frame, LINKS_JS, []) or []
        r["storage"] = _eval(page.main_frame, STORAGE_JS, {}) or {}
        r["text"] = _eval(page.main_frame, TEXT_JS, {}) or {}
        r["cookies"] = [{"name": c["name"], "value": str(c.get("value", ""))[:200]}
                        for c in ctx.cookies()]
        if (r["final_url"] or "").startswith("https://"):
            r["mixed_content"] = sorted(u[:200] for u in insecure)[:10]
    except PWTimeout as exc:
        r["outcome"], r["error"] = "timeout", str(exc)[:300]
    except PWError as exc:
        # Chromium refuses to render a page whose certificate does not verify,
        # so this is also how an invalid certificate reaches us.
        r["outcome"] = "ssl_invalid" if "ERR_CERT" in str(exc) else "load_failed"
        r["error"] = str(exc)[:300]
    finally:
        r["nonprod_requests"] = sorted(r["nonprod_requests"])
        r["captcha_seen"] = sorted(r["captcha_seen"])
        r["elapsed"] = round(time.time() - started, 1)
        try:
            ctx.close()
        except PWError:
            pass
    return r


# ── findings ────────────────────────────────────────────────────────────────

def F(fid, status, title, detail="", evidence=None):
    return {"id": fid, "status": status, "title": title, "detail": detail,
            "evidence": evidence or []}


def detect_platform(src, frames=()) -> tuple[str, str | None]:
    """Pages are routinely two platforms at once — a ClickFunnels page hosting a
    GoHighLevel form iframe is common, and naming only one hides where the form
    actually lives. Frame URLs are part of the evidence for that reason."""
    hay = (src.get("inline", "") + " " + " ".join(src.get("scripts", []))
           + " " + " ".join(frames)).lower()
    hits = [n for n, marks in PLATFORMS if any(m in hay for m in marks)]
    plugin = (next((n for n, m in WP_FORMS if any(x in hay for x in m)), None)
              if "WordPress" in hits else None)
    return " + ".join(hits[:3]) if hits else "Unknown", plugin


def _storage_hits(p: dict) -> list[str]:
    """Storage and cookies holding the test values. The gclid/fbclid sentinels
    are distinctive; the utm value 'qa' is not, so utm entries match on key name
    rather than value, to avoid inventing hits."""
    keys = ("utmsource", "utmcampaign", "gclid", "fbclid")
    hits = []
    for scope in ("local", "session"):
        for k, v in ((p.get("storage") or {}).get(scope) or {}).items():
            if "QA_TEST_" in v or any(a in _norm(k) for a in keys):
                hits.append(f"{scope}Storage  {k[:38]:38} = {v[:66]!r}")
    for c in p.get("cookies") or []:
        if "QA_TEST_" in c.get("value", "") or any(a in _norm(c["name"]) for a in keys):
            hits.append(f"cookie        {c['name'][:38]:38} = {c.get('value', '')[:66]!r}")
    return hits[:10]


# Words that make a console error or failed request plausibly related to lead
# capture. Without this filter a Google Fonts CSP violation got stapled to an
# attribution failure, implying a causal link that did not exist.
ATTR_HINTS = ("utm", "gclid", "fbclid", "attribution", "campaign", "form", "capture", "lead",
              "track", "tag", "handl", "hidden", "submit", "convert")


def _diagnostics(p: dict, hints: tuple[str, ...] | None = None) -> list[str]:
    """Console errors and failed requests, attached to whatever failed. "Field
    empty" alone is not actionable; "field empty" + "404 on utm-capture.js" is.
    With `hints`, only diagnostics plausibly related to that failure are returned
    — an unrelated error is worse than none, because it implies a cause."""
    def rel(s: str) -> bool:
        return hints is None or any(h in s.lower() for h in hints)

    out = [f"console error: {e['text']}  ({e['at']})" for e in p["console_errors"][:8]
           if rel(e["text"] + " " + e["at"])][:5]
    seen = set()
    for fr in p["failed_requests"]:
        if fr["url"] not in seen and rel(fr["url"]):
            seen.add(fr["url"])
            out.append(f"failed request: {fr['url'][:140]} — {fr['why']}")
        if len(out) > 10:
            break
    return out


def _consent_finding(a: dict, b: dict) -> dict:
    if not b.get("consent_button"):
        return F("consent", "INFO", "Consent divergence",
                 "No consent banner found, so behaviour cannot differ by consent.")
    va = {k: v[0].get("value", "") for k, v in _attr_fields(a["forms_t3"])[0].items()}
    vb = {k: v[0].get("value", "") for k, v in _attr_fields(b["forms_t3"])[0].items()}
    gained = sorted(k for k in vb if vb[k] and not va.get(k))
    tag_rx = r"\b(?:G-[A-Z0-9]{6,12}|GTM-[A-Z0-9]{4,10})\b"
    src_of = lambda p: (p.get("source") or {}).get("inline", "") + " ".join(
        (p.get("source") or {}).get("scripts", []))
    new_tags = sorted(set(re.findall(tag_rx, src_of(b))) - set(re.findall(tag_rx, src_of(a))))
    ev = ([f'banner accepted via "{b["consent_button"]}"']
          + [f"{k}: '' without consent → {vb[k]!r} with consent" for k in gained]
          + [f"tag only present after consent: {t}" for t in new_tags])
    if gained:
        return F("consent", "FAIL", "Consent divergence",
                 f"{', '.join(gained)} only populate after the banner is accepted — every "
                 "visitor who ignores the banner submits with no attribution.", ev)
    if new_tags:
        return F("consent", "INFO", "Consent divergence",
                 "Tags load only after consent (correct CMP behaviour).", ev)
    return F("consent", "PASS", "Consent divergence",
             "Attribution is identical with and without consent.", ev)


def build_report(url: str, a: dict, b: dict) -> dict:
    """`a` ignored the consent banner, `b` accepted it. `a` is the baseline — it
    is what a visitor who never touches the banner actually experiences."""
    src = a.get("source") or {}
    hay = (src.get("inline", "") + " " + " ".join(src.get("scripts", []))
           + " " + src.get("dataLayer", ""))
    frame_urls = [f.get("frame") or "" for f in a["forms_t0"] if f.get("frame") != "main"]
    plat, plugin = detect_platform(src, frame_urls)
    out = {"url": url, "checked_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
           "outcome": a["outcome"], "platform": plat, "form_plugin": plugin,
           "status_code": a["status"], "final_url": a["final_url"], "elapsed": a["elapsed"],
           "collector_hits": a["collector_hits"] + b["collector_hits"],
           "collectors_blocked": len(set(a["blocked_collectors"] + b["blocked_collectors"])),
           "findings": [], "forms": []}
    add = out["findings"].append

    # Outcomes that are not failures. A FAIL here would be a lie.
    if a["outcome"] != "ok":
        why = {"blocked": f"Page returned {a['status']} or a bot challenge — cannot verify.",
               "timeout": "Page did not load within 35s — cannot verify.",
               "ssl_invalid": "Certificate did not verify, so the browser refused the page.",
               "load_failed": "Page failed to load — cannot verify."}[a["outcome"]]
        add(F("load", "FAIL" if a["outcome"] == "ssl_invalid" else "SKIP", "Page load", why,
              [a["error"]] if a["error"] else []))
        return out

    forms = a["forms_t0"]
    out["forms"] = [{"frame": f.get("frame"), "action": f.get("action"), "method": f.get("method"),
                     "orphan": f.get("orphan"), "fields": f.get("fields", [])} for f in forms]
    real = [f for f in forms if f.get("fields") and not _is_search(f)]
    searches = len([f for f in forms if f.get("fields") and _is_search(f)])
    add(F("platform", "INFO", "Platform", plat + (f" · {plugin}" if plugin else "")))

    # 2 · forms
    in_frame = [f for f in real if f.get("frame") != "main"]
    if not real:
        hand = _handoffs(a.get("links"), a["final_url"] or url)
        add(F("forms", "SKIP", "Form discovery", "No lead form on this page — nothing to "
              "capture here." + (f" ({searches} search box(es) ignored.)" if searches else "")))
        if hand:
            keep = [h for h, ok in hand if ok]
            add(F("handoff", "PASS" if keep else "FAIL", "Conversion handoff",
                  "This page converts by sending people elsewhere, and the link carries the "
                  "campaign." if keep else
                  "This page has no form and converts by sending people elsewhere — but the "
                  "handoff link carries no campaign parameters, so attribution ends here.",
                  [f"{'carries' if ok else 'drops  '} attribution  {h[:110]}" for h, ok in hand]))
    else:
        note = f"{len(real)} form(s)"
        note += f" ({searches} search box(es) ignored)" if searches else ""
        note += f", {len(in_frame)} inside an iframe" if in_frame else ""
        note += ("; some fields sit outside any <form> and submit by handler"
                 if any(f.get("orphan") for f in real) else "")
        add(F("forms", "PASS", "Form discovery", note,
              [f"{f.get('frame')} · {len(f.get('fields', []))} fields" for f in real[:6]]))

    # 3 · field inventory
    if real:
        inv = [f"{'hidden' if fl['hidden'] else 'visible':7} {fl['name'][:38]:38} {fl['type'][:10]}"
               for f in real[:4] for fl in f.get("fields", [])[:25] if fl.get("name")]
        add(F("fields", "INFO", "Field inventory",
              f"{sum(len(f.get('fields', [])) for f in real)} fields total", inv))

    # 4 · attribution population — the core check
    (at0, anon0), (at3, anon3) = _attr_fields(a["forms_t0"]), _attr_fields(a["forms_t3"])
    anon = anon0 or anon3
    store = _storage_hits(a)
    if not real:
        pass
    elif not at0 and not at3 and not anon:
        if store:
            add(F("attribution", "WARN", "Attribution population",
                  "No hidden attribution fields, but the values are in browser storage — this "
                  "page most likely injects them at submit time. Verify a test lead carries "
                  "them.", store))
        else:
            add(F("attribution", "FAIL", "Attribution population",
                  "No hidden attribution fields at all. Every lead from this page arrives with "
                  "no campaign, and nothing in storage to inject later.", _diagnostics(a, ATTR_HINTS)))
    else:
        ev, missing, late, empty = [], [], [], []
        for key in ATTR_KEYS:
            f0 = at0.get(key, [None])[0]
            f3 = at3.get(key, [None])[0]
            if not f0 and not f3:
                missing.append(key)
                continue
            v0, v3 = (f0 or {}).get("value", ""), (f3 or {}).get("value", "")
            name = (f0 or f3 or {}).get("name", key)
            if v0:
                ev.append(f"{key:12} {name[:26]:26} = {v0!r}  ok at load")
            elif v3:
                ev.append(f"{key:12} {name[:26]:26} = {v3!r}  only after 3s")
                late.append(key)
            else:
                ev.append(f"{key:12} {name[:26]:26} = ''  empty at load and at 3s")
                empty.append(key)
        detail, status = [], "PASS"
        if empty:
            status = "FAIL"
            detail.append(f"{', '.join(empty)} exist as fields but never populate")
        # Value-matched fields cover the UTMs a renaming plugin hid from us.
        utm_missing = [k for k in missing if k.startswith("utm_")]
        if utm_missing and len(anon) >= len(utm_missing):
            ev.append(f"{len(anon)} unnamed hidden field(s) hold the UTM test value "
                      f"({', '.join(f.get('name', '?') for f in anon[:6])}) — the form plugin "
                      "renames fields, so which param is which cannot be read from the page")
            missing = [k for k in missing if not k.startswith("utm_")]
        if missing:
            paid = [k for k in missing if k in ("gclid", "fbclid")]
            status = "FAIL" if paid else ("WARN" if status == "PASS" else status)
            detail.append(f"no field for {', '.join(missing)}"
                          + (" — paid clicks arrive unattributed" if paid else ""))
        if late:
            status = "WARN" if status == "PASS" else status
            detail.append(f"{', '.join(late)} only populate after 3s — a fast submitter loses them")
        if status != "PASS" and store:
            detail.append("values ARE in browser storage, so this may be injected at submit")
            ev += store
        add(F("attribution", status, "Attribution population",
              "; ".join(detail) or "every test parameter reached a hidden field",
              ev + (_diagnostics(a, ATTR_HINTS) if status == "FAIL" else [])))

    # 5 · storage fallback, reported separately so the diagnosis is visible
    add(F("storage", "INFO", "Storage fallback",
          f"{len(store)} storage/cookie entries hold the test values" if store
          else "test values are not in storage or cookies", store))

    # 6 · endpoint — one finding covering every form; a page with three forms was
    # emitting three near-identical rows.
    if real:
        page_host = _registrable(urlparse(a["final_url"] or url).netloc)
        rows, sev, notes = [], "PASS", []
        for f in real:
            act = (f.get("action") or "").strip()
            dest = urljoin(a["final_url"] or url, act) if act else (a["final_url"] or url)
            netloc = urlparse(dest).netloc
            host = _registrable(netloc)
            if _nonprod_host(netloc):
                sev, tag = "FAIL", "non-production endpoint"
                notes.append("posts to a non-production endpoint")
            elif not act and not f.get("orphan"):
                tag = "no action — submits to itself or by handler"
            elif host and host != page_host:
                sev = "INFO" if sev == "PASS" else sev
                tag = f"off-domain → {host}"
                notes.append(f"one form posts off-domain to {host}; confirm it is the client's "
                             "collector and not a builder default")
            else:
                tag = "same domain"
            rows.append(f"{(f.get('frame') or 'main')[:40]:40} {tag}  {dest[:80]}")
        add(F("endpoint", sev, "Form endpoint", "; ".join(dict.fromkeys(notes))
              or "every form posts to the site's own domain", rows))

    # 7 · anti-spam
    kinds = [n for n, marks in CAPTCHAS if any(m in hay for m in marks)]
    for f in real:
        for fl in f.get("fields", []):
            k = CAPTCHA_FIELDS.get((fl.get("name") or "").lower())
            if k and k not in kinds:
                kinds.append(k)
    kinds += [k for k in (a.get("captcha_seen") or []) if k not in kinds]
    keys = src.get("sitekeys") or []
    pots = [fl.get("name") for f in real for fl in f.get("fields", [])
            if any(h in (fl.get("name") or "").lower() for h in HONEYPOT)]
    if not kinds:
        add(F("captcha", "INFO", "Anti-spam",
              f"No captcha, but a honeypot field is present ({pots[0]})." if pots
              else "No captcha detected." + (" Expect form spam." if real else ""), pots[:3]))
    else:
        # Only a script/API request can break a captcha. An aborted logo.png was
        # being reported as "the captcha failed to load"; it is a cosmetic asset.
        # Extension is checked as well as resource type, because hCaptcha pulls
        # its own logo via fetch(), so Chromium types the image as "fetch".
        assets = (".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp", ".css", ".woff", ".woff2")
        broke = [x for x in a["failed_requests"]
                 if any(h in x["url"] for h in CAPTCHA_HOSTS)
                 and x.get("type") in ("script", "xhr", "fetch", "document")
                 and not urlparse(x["url"]).path.lower().endswith(assets)]
        hard = [x for x in broke if any(h in x["why"] for h in HARD_FAIL)]
        v3 = "render=" in hay or "grecaptcha.execute" in hay
        ev = [f"{x['url'][:120]} — {x['why']}" for x in broke]
        # Name every vendor detected. Picking the first match reported "reCAPTCHA"
        # on a page whose captcha was hCaptcha, because a stray grecaptcha
        # reference sorted ahead of the one actually in use.
        name = ", ".join(kinds)
        if hard:
            add(F("captcha", "FAIL", "Anti-spam", f"{name} script failed to load — every "
                  "submission will be blocked while the page looks fine.", ev))
        elif broke:
            add(F("captcha", "WARN", "Anti-spam", f"{name} present, but a request for it was "
                  "aborted. Aborts are ambiguous — re-run before trusting this.", ev))
        elif not keys and not v3:
            add(F("captcha", "WARN", "Anti-spam", f"{name} is present but no site key was "
                  "found in source — it may be injected at runtime. Verify by hand."))
        else:
            add(F("captcha", "PASS", "Anti-spam", name + (" v3 (invisible)" if v3 else ""),
                  [f"site key {k[:20]}…" for k in keys[:3]]))

    # 8 · tracking inventory — read from source, never from a fired request
    ga = sorted(set(re.findall(r"\bG-[A-Z0-9]{6,12}\b", hay)))
    gtm = sorted(set(re.findall(r"\bGTM-[A-Z0-9]{4,10}\b", hay)))
    fb = sorted(set(re.findall(r"fbq\(\s*['\"]init['\"]\s*,\s*['\"](\d{6,20})", hay)
                    + re.findall(r"facebook\.com/tr\?id=(\d{6,20})", hay)))
    # A container ID of all X's is boilerplate someone forgot to fill in, not a
    # second container. Counting it produced a false double-counting warning.
    stub = [i for i in ga + gtm + fb if "XXXX" in i.upper()]
    ga, gtm, fb = ([i for i in ga if i not in stub], [i for i in gtm if i not in stub],
                   [i for i in fb if i not in stub])
    lines = ([f"GA4       {i}" for i in ga] + [f"GTM       {i}" for i in gtm]
             + [f"Meta      {i}" for i in fb]
             + [f"unfilled  {i}  <- placeholder left in source" for i in stub])
    dupes = [n for n, ids in (("GA4", ga), ("GTM", gtm), ("Meta pixel", fb)) if len(ids) > 1]
    if dupes:
        add(F("tracking", "WARN", "Tracking inventory",
              f"more than one {', '.join(dupes)} ID — conversions will be double-counted", lines))
    elif stub:
        add(F("tracking", "WARN", "Tracking inventory",
              "a placeholder tag ID was left in the page source", lines))
    elif not lines:
        fbevents = "connect.facebook.net" in hay
        add(F("tracking", "WARN" if fbevents else "INFO", "Tracking inventory",
              "Meta's library loads but no pixel ID is ever set — it records nothing."
              if fbevents else "No GA4, GTM or Meta pixel found in page source."))
    else:
        add(F("tracking", "PASS", "Tracking inventory", f"{len(lines)} tag(s), no duplicates",
              lines))

    # 9 · consent divergence — the pass single-pass checkers cannot make
    add(_consent_finding(a, b))

    # 10 · placeholders
    hits = []
    for label, blob in (("visible", (a["text"] or {}).get("shown", "")),
                        ("hidden", (a["text"] or {}).get("hidden", ""))):
        for pat in PLACEHOLDERS:
            m = re.search(pat, blob, re.I)
            if m:
                hits.append(f"{label}: …{blob[max(0, m.start() - 40):m.end() + 40].strip()[:110]}…")
    hits = hits[:8]
    add(F("placeholder", "FAIL" if hits else "PASS", "Placeholder content",
          f"{len(hits)} placeholder pattern(s) still on the page" if hits
          else "no lorem ipsum, TODO or sample contact details", hits))

    # 11a · non-production endpoints anywhere on the page, form or not
    np = sorted(set(a["nonprod_requests"]) | set(b.get("nonprod_requests") or []))
    if np:
        page_netloc = urlparse(a["final_url"] or url).netloc.lower()
        preview = [d for d in PREVIEW_DOMAINS if page_netloc.endswith(d)]
        dead = [x["url"] for x in a["failed_requests"] if x["url"] in set(np)]
        hosts = {urlparse(u).netloc for u in np}
        add(F("nonprod", "WARN" if preview else "FAIL", "Non-production endpoint",
              (f"This page is served from {preview[0]}, a builder preview domain, so calling a "
               f"non-production backend may be intentional here — but on the client's live "
               f"domain it would not be. Calls to {', '.join(hosts)}"
               if preview else
               f"A live page calls {len(hosts)} non-production host(s): {', '.join(hosts)}")
              + (" are failing." if dead else " succeed."),
              [u[:150] for u in np[:8]]
              + _diagnostics(a, tuple(h for h in hosts))[:4]))

    # 11 · production hygiene
    robots = ((src.get("robots") or "") + " " + (a.get("x_robots") or "")).lower()
    ev = ([f"X-Robots-Tag: {a['x_robots']}"] if a.get("x_robots") else []) + (
        [f'<meta name="robots" content="{src["robots"]}">'] if src.get("robots") else [])
    if "noindex" in robots or "nofollow" in robots:
        add(F("hygiene", "FAIL", "Production hygiene", "Live page is set noindex/nofollow.", ev))
    elif not (a["final_url"] or "").startswith("https://"):
        add(F("hygiene", "FAIL", "Production hygiene", "Page is not served over HTTPS.",
              [a["final_url"] or url]))
    elif a["mixed_content"]:
        add(F("hygiene", "WARN", "Production hygiene", "HTTPS page loads http:// resources.",
              a["mixed_content"]))
    else:
        add(F("hygiene", "PASS", "Production hygiene",
              "HTTPS, certificate verified by the browser, indexable.", ev))

    # 12 · diagnostics
    diag = _diagnostics(a)
    add(F("diagnostics", "WARN" if diag else "PASS", "Diagnostics",
          f"{len(a['console_errors'])} console error(s), {len(a['failed_requests'])} failed "
          f"request(s)" if diag else "no console errors, no failed requests", diag))

    if out["collector_hits"]:
        out["findings"].insert(0, F("collectors", "FAIL", "Analytics safety",
                                    "A collector request completed — this run may have polluted "
                                    "client data. Report this; it is a tool bug.",
                                    out["collector_hits"][:10]))
    return out


def check_url(browser, url: str, outdir: Path | None = None, pw=None,
              responsive: bool = False, cross: bool = False) -> dict:
    t0 = time.time()
    a = run_pass(browser, url, accept_consent=False)
    b = (run_pass(browser, url, accept_consent=True) if a["outcome"] == "ok"
         else {**a, "consent_button": None})
    rep = build_report(url, a, b)
    rep["phases"] = {"capture": round(time.time() - t0, 1)}

    # The sweep is opt-in: it is eight more page loads, so making it automatic
    # would quintuple the cost of a plain capture check.
    if responsive and outdir is not None and a["outcome"] == "ok":
        sweep = run_responsive(browser, url, outdir)
        rep["responsive"] = sweep
        rep["findings"] += responsive_findings(sweep)
        rep["phases"]["responsive"] = sweep["elapsed"]
        rep["collector_hits"] += sweep.get("hits") or []
    elif responsive and outdir is not None:
        rep["findings"].append(F("responsive", "SKIP", "Responsive sweep",
                                 "Page did not load, so there was nothing to measure."))

    if cross and pw is not None and outdir is not None and a["outcome"] == "ok":
        cr = run_cross(pw, url, outdir)
        rep["cross"] = cr
        rep["findings"] += cross_findings(cr)
        rep["phases"]["cross_browser"] = cr["elapsed"]
        for _e in (cr.get("engines") or {}).values():
            rep["collector_hits"] += _e.get("hits") or []
    return rep



# ── responsive sweep (Phase 2) ──────────────────────────────────────────────
# Eight widths, five of them inside the small-mobile band, because that band is
# where the team's hand-checking finds bugs. Heights are realistic for each
# class of device; device scale factor stays 1 so screenshots are 1:1 with CSS
# pixels and a reviewer can trust what they measure on screen.
WIDTHS: tuple[tuple[int, int], ...] = (
    (350, 750), (375, 812), (425, 900), (450, 900), (470, 900),
    (768, 1024), (1024, 768), (1440, 900),
)
WIDTH_LIST = [w for w, _ in WIDTHS]

RESPONSIVE_JS = """(vw) => {
  const TOL = 2;
  const vis = (el) => {
    const s = getComputedStyle(el);
    if (s.display === 'none' || s.visibility === 'hidden' || parseFloat(s.opacity || '1') === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0.5 && r.height > 0.5;
  };
  const sel = (el) => {
    const id = el.id ? '#' + el.id : '';
    let cls = '';
    if (typeof el.className === 'string' && el.className.trim()) {
      cls = '.' + el.className.trim().split(/\\s+/).slice(0, 2).join('.');
    }
    return (el.tagName.toLowerCase() + id + cls).slice(0, 70);
  };
  const ownText = (el) => {
    for (const n of el.childNodes) if (n.nodeType === 3 && n.textContent.trim().length > 1) return true;
    return false;
  };
  const anyText = (el) => (el.innerText || '').trim().length > 1;
  // Rendered glyph boxes, not element boxes. Two elements whose boxes intersect
  // are routine — a negative margin does it — and reporting those produced a
  // false positive on a testimonial that renders perfectly. Text physically
  // colliding with text is the only version of this worth a human's time.
  const textRects = (el) => {
    const out = [];
    const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let n, budget = 250;
    while ((n = w.nextNode()) && budget-- > 0) {
      if (!n.textContent.trim()) continue;
      const rg = document.createRange();
      rg.selectNodeContents(n);
      for (const r of rg.getClientRects()) if (r.width > 1 && r.height > 1) out.push(r);
    }
    return out;
  };
  const glyphHit = (A, B) => {
    for (const a of A) for (const b of B) {
      const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left);
      const oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      if (ox > 1 && oy > 1 && ox * oy >= 24) return Math.round(ox * oy);
    }
    return 0;
  };
  const snippet = (el) => (el.innerText || el.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 60);
  // An element sticking out inside a container that clips or scrolls does not
  // break the page. Only unclipped overflow can move the document.
  const clipped = (el) => {
    let n = el.parentElement;
    while (n && n !== document.documentElement) {
      const s = getComputedStyle(n);
      if (/hidden|clip|auto|scroll/.test(s.overflowX)) return true;
      n = n.parentElement;
    }
    return false;
  };
  // Only auto/scroll — a strip the visitor can scroll sideways is meant to
  // extend past the edge. Deliberately NOT hidden/clip: content clipped at the
  // viewport edge is the bug the edge check exists to find.
  const scrollableAnc = (el) => {
    let n = el.parentElement;
    while (n && n !== document.documentElement) {
      if (/auto|scroll/.test(getComputedStyle(n).overflowX)) return true;
      n = n.parentElement;
    }
    return false;
  };

  const SLIDERS = '[class*="splide"],[class*="swiper"],[class*="slick"],[class*="carousel"],'
    + '[class*="slider"],[class*="glide"],[class*="flickity"],[class*="marquee"],'
    + '[class*="ticker"],[class*="track"],[id*="track"],[class*="loop"]';
  const doc = document.documentElement;
  // A bot challenge renders a perfectly tidy page. Measuring it and reporting
  // PASS is the worst outcome available: a silent all-clear on a page nobody
  // actually saw. Cloudflare rate-limited a run and this went unnoticed.
  const t = (document.title || '').toLowerCase();
  const hit = document.querySelector('.cf-error-overview, #challenge-running, #challenge-form');
  const titleHit = /just a moment|attention required|you have been blocked|access denied|verify you are human/.test(t);
  if (hit || titleHit) {
    return { challenged: true,
             challengedWhy: hit ? ('matched ' + (hit.className || hit.id)) : ('title: ' + t.slice(0, 60)),
             docOverflow: 0, culprits: [], cut: [], edge: [], overlaps: [], cta: null };
  }

  const docOverflow = Math.max(0, doc.scrollWidth - doc.clientWidth);
  const all = [...document.querySelectorAll('body *')];

  // 1 · horizontal overflow. Gated on the document actually scrolling sideways:
  // without that gate every decorative element bleeding off a clipped hero
  // would be reported as a break.
  const culprits = [];
  if (docOverflow >= 3) {
    for (const el of all) {
      if (!vis(el)) continue;
      if (getComputedStyle(el).position === 'fixed') continue;
      const r = el.getBoundingClientRect();
      if (r.right <= vw + TOL) continue;
      if (clipped(el)) continue;
      // Report where the excess is introduced, not every descendant of it.
      const p = el.parentElement;
      if (p && p !== document.body && p.getBoundingClientRect().right > vw + TOL) continue;
      culprits.push({ sel: sel(el), right: Math.round(r.right), width: Math.round(r.width),
                      over: Math.round(r.right - vw), text: snippet(el) });
      if (culprits.length >= 8) break;
    }
  }

  // 1b · content cut off at the viewport edge.
  //
  // The overflow check above is gated on the document actually scrolling
  // sideways, which is right for a decorative background bleeding out of a
  // clipped hero — but it also hid a real bug: a photo 35px past a 1024px
  // viewport, clipped so the page never scrolled, reported as a clean pass.
  // Content is the distinction. Only images and text-bearing elements count,
  // only when part of them is still on screen (an off-canvas menu is
  // deliberate), and sliders are excluded because their track is meant to sit
  // outside the frame.
  const edge = [];
  for (const el of all) {
    if (!vis(el)) continue;
    const st = getComputedStyle(el);
    if (st.position === 'fixed') continue;
    const isImg = el.tagName === 'IMG' || el.tagName === 'PICTURE';
    if (!isImg && !ownText(el)) continue;
    if (el.closest(SLIDERS)) continue;
    const r = el.getBoundingClientRect();
    const cutR = Math.round(r.right - vw);
    const cutL = Math.round(-r.left);
    const cut = Math.max(cutR, cutL);
    if (cut < 8) continue;
    if (r.right <= 0 || r.left >= vw) continue;          // wholly off screen
    // A horizontally SCROLLABLE strip is meant to extend past the edge — a
    // filter bar of trades reported every off-screen chip as cut content. Only
    // auto/scroll qualifies: an ancestor with overflow:hidden is exactly the
    // case this check exists for (a photo clipped at the viewport edge), so
    // reusing clipped() here silently undid that.
    if (scrollableAnc(el)) continue;
    const frac = Math.round((cut / Math.max(1, r.width)) * 100);
    // Barely-visible slivers are off-canvas by design (carousel neighbours,
    // decorative art), not content someone is losing.
    if (frac >= 90) continue;
    edge.push({ sel: sel(el), tag: el.tagName, cut, frac,
                side: cutR >= cutL ? 'right' : 'left', text: snippet(el) });
    if (edge.length >= 8) break;
  }

  // 2 · clipped or truncated text. Ellipsis and line-clamp are deliberate, so
  // they are not findings.
  const cut = [];
  for (const el of all) {
    if (!vis(el) || !ownText(el)) continue;
    const s = getComputedStyle(el);
    const hidX = /hidden|clip/.test(s.overflowX);
    const hidY = /hidden|clip/.test(s.overflowY);
    if (!hidX && !hidY) continue;
    if (s.textOverflow === 'ellipsis') continue;
    if (s.webkitLineClamp && s.webkitLineClamp !== 'none') continue;
    // A box with no visible area is not clipping text, it is hiding it on
    // purpose: collapsed accordions (clientHeight 0) and screen-reader-only
    // links (clientWidth 1) both landed here and both were false positives.
    if (el.clientWidth < 8 || el.clientHeight < 8) continue;
    if (el.closest('[aria-expanded="false"], [aria-hidden="true"], [hidden]')) continue;
    const dx = el.scrollWidth - el.clientWidth;
    const dy = el.scrollHeight - el.clientHeight;
    if ((hidX && dx >= 4) || (hidY && dy >= 4)) {
      cut.push({ sel: sel(el), dx: Math.max(0, dx), dy: Math.max(0, dy), text: snippet(el) });
      if (cut.length >= 8) break;
    }
  }

  // 3 · overlapping siblings involving text. Positioned elements are excluded:
  // badges, sticky headers and dropdowns overlap on purpose.
  const overlaps = [];
  const parents = new Set();
  for (const el of all) if (el.children.length > 1) parents.add(el);
  outer:
  for (const p of parents) {
    const kids = [...p.children].filter((k) => {
      if (!vis(k)) return false;
      const s = getComputedStyle(k);
      return s.position === 'static' || s.position === 'relative';
    });
    for (let i = 0; i < kids.length; i++) {
      for (let j = i + 1; j < kids.length; j++) {
        const a = kids[i], b = kids[j];
        if (a.contains(b) || b.contains(a)) continue;
        if (!anyText(a) || !anyText(b)) continue;
        // Cheap box prefilter first; the glyph test below is the expensive part.
        const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
        const ox = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left);
        const oy = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
        if (ox <= 2 || oy <= 2) continue;
        const hit = glyphHit(textRects(a), textRects(b));
        if (!hit) continue;
        overlaps.push({ a: sel(a), b: sel(b), area: hit,
                        pct: Math.round((hit / Math.max(1, Math.min(ra.width * ra.height,
                                                                    rb.width * rb.height))) * 100),
                        text: snippet(a) });
        if (overlaps.length >= 6) break outer;
      }
    }
  }

  // 4 · the most prominent call to action. Reported, never judged.
  const CTA = /\\b(get|start|book|buy|call|contact|request|apply|sign ?up|subscribe|download|quote|demo|free|try|order|schedule|enquire|inquire|join|shop|claim|reserve)\\b/i;
  let best = null;
  for (const el of document.querySelectorAll('a,button,input[type=submit],input[type=button],[role=button]')) {
    if (!vis(el)) continue;
    const t = ((el.innerText || el.value || '') + '').trim().replace(/\\s+/g, ' ');
    if (!t || t.length > 40) continue;
    const r = el.getBoundingClientRect();
    const area = r.width * r.height;
    if (area < 400) continue;
    // A footer newsletter box is always below the fold, so letting it win made
    // the whole check vacuous — it beat the hero CTA on a contact page.
    if (el.closest('footer, [class*="footer" i], [id*="footer" i]')) continue;
    // One of many identical siblings is a list or a nav, not THE call to
    // action. A lesson-list item won on a course page purely by being large and
    // near the top. A hero CTA is singular; excluding repeats keeps the header
    // CTA that legitimately sits in a nav bar.
    // A repeated item inside a list or nav is navigation, not THE call to
    // action. Both conditions are required. Counting same-tag siblings alone
    // was too blunt: an Unbounce mobile layout puts every anchor under one flat
    // root, so seven unrelated siblings excluded every real CTA on the page and
    // left an email address in the footer as the only survivor.
    const par = el.parentElement;
    if (par && el.closest('nav,ul,ol,[role="list"],[role="navigation"],[role="menu"],[role="tablist"]')) {
      let twins = 0;
      for (const sib of par.children) if (sib !== el && sib.tagName === el.tagName) twins++;
      if (twins >= 3) continue;
    }
    const s = getComputedStyle(el);
    const filled = !/^rgba?\\(0, 0, 0, 0\\)$|transparent/.test(s.backgroundColor || '');
    const top = Math.round(r.top + window.scrollY);
    // Prominence decays down the page: the thing a visitor is meant to do sits
    // near the top, not 2000px into the tail.
    const posW = 1 / (1 + (Math.max(0, top) / Math.max(1, doc.scrollHeight)) * 4);
    const score = area * (CTA.test(t) ? 2.5 : 1) * (filled ? 1.5 : 1) * posW;
    if (!best || score > best.score) {
      best = { score: Math.round(score), sel: sel(el), text: t.slice(0, 40),
               top: top, height: Math.round(r.height) };
    }
  }

  return { challenged: false, docOverflow, docWidth: doc.scrollWidth,
           pageHeight: doc.scrollHeight, culprits, cut, edge, overlaps, cta: best };
}"""


def _keys(d: dict | None) -> frozenset:
    """What a reading claims, ignoring exact pixel counts."""
    if not d:
        return frozenset()
    # Measurements are part of the identity, bucketed so ordinary jitter still
    # matches. An element whose numbers swing between readings is animating,
    # and an animation is not a layout bug.
    b = lambda n: round((n or 0) / 16)
    return frozenset(
        [("e", c["sel"], b(c.get("cut"))) for c in d.get("edge") or []]
        + [("o", c["sel"], b(c.get("over"))) for c in d.get("culprits") or []]
        + [("c", c["sel"], b(c.get("dx")), b(c.get("dy"))) for c in d.get("cut") or []]
        + [("v", o["a"], o["b"]) for o in d.get("overlaps") or []]
        + [("cta", (d.get("cta") or {}).get("sel", ""))])


def _settle(d1: dict | None, d2: dict | None) -> dict | None:
    """Keep only what two readings agree on.

    A third-party widget still laying itself out reports nonsense: a GoHighLevel
    submit button measured 545px of hidden overflow mid-render and exactly zero
    once settled — and while it was still rendering it was not yet a candidate
    for the primary CTA either, so a mid-page button won instead. Anything that
    appears in only one of two passes is dropped."""
    if not d1 or not d2:
        return d2 or d1
    b = lambda n: round((n or 0) / 16)
    out = dict(d2)
    for key, ident in (("edge", lambda x: (x["sel"], b(x.get("cut")))),
                       ("culprits", lambda x: (x["sel"], b(x.get("over")))),
                       ("cut", lambda x: (x["sel"], b(x.get("dx")), b(x.get("dy")))),
                       ("overlaps", lambda x: (x["a"], x["b"]))):
        seen = {ident(x) for x in (d1.get(key) or [])}
        out[key] = [x for x in (d2.get(key) or []) if ident(x) in seen]
    out["docOverflow"] = min(d1.get("docOverflow", 0), d2.get("docOverflow", 0))
    return out


def _ranges(widths: list[int]) -> str:
    """"350–470" rather than five near-identical rows. Five of the eight widths
    sit within 120px of each other, so almost every real finding repeats across
    all of them; printing each one separately makes a report nobody reads."""
    idx = sorted(WIDTH_LIST.index(w) for w in set(widths))
    groups: list[list[int]] = []
    for i in idx:
        if groups and i == groups[-1][-1] + 1:
            groups[-1].append(i)
        else:
            groups.append([i])
    return ", ".join(str(WIDTH_LIST[g[0]]) if len(g) == 1
                     else f"{WIDTH_LIST[g[0]]}–{WIDTH_LIST[g[-1]]}" for g in groups)


def run_responsive(browser, url: str, outdir: Path) -> dict:
    """One fresh context per width. A context each is slower than resizing one
    page, but it guarantees the collector route is armed on every one of the
    eight loads — eight chances to pollute client analytics otherwise — and it
    stops a consent choice made at 350px changing the layout measured at 1440."""
    started = time.time()
    out = {"widths": [], "shots": [], "errors": [], "hits": []}
    target = with_params(url)
    for w, h in WIDTHS:
        t0 = time.time()
        ctx = browser.new_context(user_agent=UA, viewport={"width": w, "height": h},
                                  device_scale_factor=1, locale="en-AU")
        ctx.set_default_timeout(20000)
        blocked: list[str] = []
        ctx.route(COLLECTOR_RX, lambda rt, req, b=blocked: (b.append(req.url), rt.abort()))
        page = ctx.new_page()
        # Counting blocks proves the route fired; only counting COMPLETED
        # collector requests proves nothing got through. Eight loads per page
        # is eight chances, so the guarantee is checked here too.
        page.on("requestfinished",
                lambda rq: out["hits"].append(rq.url[:200]) if COLLECTOR_RX.search(rq.url) else None)
        try:
            page.goto(target, wait_until="domcontentloaded", timeout=35000)
            try:
                page.wait_for_load_state("networkidle", timeout=10000)
            except PWTimeout:
                pass
            # Poll until the layout stops changing rather than guessing a fixed
            # wait. A fixed 2.1s window still measured a GoHighLevel form
            # mid-render and produced two false findings from it; fast pages
            # should not pay for that, so this exits as soon as two consecutive
            # readings agree, and falls back to their intersection if they never do.
            page.wait_for_timeout(1200)
            reads = [_eval(page.main_frame, RESPONSIVE_JS, None, w)]
            for _ in range(4):
                page.wait_for_timeout(700)
                reads.append(_eval(page.main_frame, RESPONSIVE_JS, None, w))
                if _keys(reads[-1]) == _keys(reads[-2]):
                    break        # stable; stop paying for polls
            # Always the intersection of the last two readings, stable or not.
            # A permanently animating element never converges — this page has a
            # submit button whose scrollWidth cycles 314→478→667→314 forever —
            # and its numbers must never become findings. Keeping the last two
            # readings distinct matters: collapsing them made this a no-op.
            data = _settle(reads[-2], reads[-1]) if len(reads) > 1 else reads[0]
            shot = outdir / f"w{w:04d}.png"
            try:
                # Clipped to the viewport WIDTH, full height. A plain full-page
                # capture widens to the scrollWidth, so a page that overflows
                # produced a 958px-wide image for a 768px viewport — showing
                # content the visitor cannot see without scrolling sideways, and
                # hiding the very bug the run had just found.
                ph = int((data or {}).get("pageHeight") or 0)
                if ph > 0:
                    # full_page AND clip together: clip alone is relative to the
                    # viewport and silently truncated every capture to one screen.
                    page.screenshot(path=str(shot), full_page=True,
                                    clip={"x": 0, "y": 0, "width": w, "height": min(ph, 30000)})
                else:
                    page.screenshot(path=str(shot), full_page=True)
                out["shots"].append({"width": w, "path": str(shot)})
            except PWError as exc:
                out["errors"].append(f"{w}px screenshot failed: {str(exc)[:120]}")
            if data:
                data.update({"width": w, "height": h, "blocked": len(blocked),
                             "elapsed": round(time.time() - t0, 1)})
                out["widths"].append(data)
        except (PWError, PWTimeout) as exc:
            out["errors"].append(f"{w}px: {type(exc).__name__}: {str(exc)[:140]}")
        finally:
            try:
                ctx.close()
            except PWError:
                pass
    out["elapsed"] = round(time.time() - started, 1)
    return out


def responsive_findings(r: dict) -> list[dict]:
    """Collapse per-width results into one finding per distinct problem."""
    F_ = F
    out: list[dict] = []
    if r.get("errors"):
        out.append(F_("responsive-load", "SKIP", "Responsive sweep",
                      f"{len(r['errors'])} width(s) could not be measured.", r["errors"][:5]))
    if not r.get("widths"):
        return out

    blocked_w = [wd["width"] for wd in r["widths"] if wd.get("challenged")]
    if blocked_w:
        why = sorted({wd.get("challengedWhy", "") for wd in r["widths"] if wd.get("challenged")})
        out.append(F_("blocked", "SKIP", "Blocked at some widths",
                      f"A bot challenge was served at {_ranges(blocked_w)}, so those widths "
                      "measured nothing real. Re-run, more slowly, before trusting this page.",
                      [w for w in why if w][:3]))
    # Everything below reads only the widths that actually rendered the page.
    r = {**r, "widths": [wd for wd in r["widths"] if not wd.get("challenged")]}
    if not r["widths"]:
        return out

    # 1 · overflow, keyed by culprit element
    by_el: dict[str, dict] = {}
    for wd in r["widths"]:
        for c in wd.get("culprits", []):
            e = by_el.setdefault(c["sel"], {"widths": [], "over": 0, "text": c.get("text", "")})
            e["widths"].append(wd["width"])
            e["over"] = max(e["over"], c.get("over", 0))
    worst_doc = max((wd.get("docOverflow", 0) for wd in r["widths"]), default=0)
    if by_el:
        # A couple of pixels is rounding, not a broken layout.
        sev = "FAIL" if worst_doc >= 12 else "WARN"
        ev = [f"{_ranges(e['widths']):18} {s:44} +{e['over']}px  {e['text'][:32]!r}"
              for s, e in sorted(by_el.items(), key=lambda kv: -kv[1]["over"])[:8]]
        hit = sorted({w for e in by_el.values() for w in e["widths"]})
        out.append(F_("overflow", sev, "Horizontal overflow",
                      f"The page scrolls sideways at {_ranges(hit)} — worst excess "
                      f"{worst_doc}px past the viewport.", ev))
    else:
        out.append(F_("overflow", "PASS", "Horizontal overflow",
                      "No sideways scroll at any of the eight widths."))

    # 1b · content cut at the viewport edge
    by_edge: dict[str, dict] = {}
    for wd in r["widths"]:
        for e in wd.get("edge", []):
            g = by_edge.setdefault(e["sel"], {"widths": [], "cut": 0, "frac": 0,
                                              "tag": e.get("tag", ""), "text": e.get("text", "")})
            g["widths"].append(wd["width"])
            g["cut"], g["frac"] = max(g["cut"], e["cut"]), max(g["frac"], e.get("frac", 0))
    if by_edge:
        ev = [f"{_ranges(g['widths']):18} {s_:40} {g['cut']}px cut ({g['frac']}% of it)  {g['text'][:26]!r}"
              for s_, g in sorted(by_edge.items(), key=lambda kv: -kv[1]["cut"])[:8]]
        out.append(F_("edge", "WARN", "Content cut off at the edge",
                      f"{len(by_edge)} image(s) or text block(s) run past the viewport and are "
                      "clipped. Some bleed is deliberate — check the screenshots.", ev))
    else:
        out.append(F_("edge", "PASS", "Content cut off at the edge",
                      "Nothing runs past the viewport edge."))

    # 2 · clipped text — ambiguous by nature, so it never escalates past WARN
    by_cut: dict[str, dict] = {}
    for wd in r["widths"]:
        for c in wd.get("cut", []):
            e = by_cut.setdefault(c["sel"], {"widths": [], "dx": 0, "dy": 0, "text": c.get("text", "")})
            e["widths"].append(wd["width"])
            e["dx"], e["dy"] = max(e["dx"], c["dx"]), max(e["dy"], c["dy"])
    if by_cut:
        ev = [f"{_ranges(e['widths']):18} {s:44} cut {e['dx']}x{e['dy']}px  {e['text'][:30]!r}"
              for s, e in list(by_cut.items())[:8]]
        out.append(F_("clipped", "WARN", "Clipped text",
                      f"{len(by_cut)} element(s) hide part of their text behind "
                      "overflow:hidden. Check the screenshots — some clipping is deliberate.", ev))
    else:
        out.append(F_("clipped", "PASS", "Clipped text", "No text clipped by a hidden overflow."))

    # 3 · overlapping text
    by_ov: dict[tuple[str, str], dict] = {}
    for wd in r["widths"]:
        for o in wd.get("overlaps", []):
            k = (o["a"], o["b"])
            e = by_ov.setdefault(k, {"widths": [], "pct": 0, "text": o.get("text", "")})
            e["widths"].append(wd["width"])
            e["pct"] = max(e["pct"], o["pct"])
    if by_ov:
        ev = [f"{_ranges(e['widths']):18} {a} over {b}  {e['pct']}%  {e['text'][:28]!r}"
              for (a, b), e in sorted(by_ov.items(), key=lambda kv: -kv[1]["pct"])[:6]]
        out.append(F_("overlap", "WARN", "Overlapping text",
                      f"{len(by_ov)} pair(s) of siblings overlap where one carries text. "
                      "Confirm against the screenshots before reporting.", ev))
    else:
        out.append(F_("overlap", "PASS", "Overlapping text", "No text-bearing siblings overlap."))

    # 4 · CTA position — measured, not judged
    rows, below = [], []
    for wd in r["widths"]:
        cta = wd.get("cta")
        if not cta:
            continue
        fold = cta["top"] >= wd["height"]
        rows.append(f"{wd['width']:>5}px x {wd['height']:>4}   top {cta['top']:>5}px"
                    f"   {'below fold' if fold else 'in view  '}   {cta['text'][:22]!r}"
                    f"  {cta.get('sel', '')[:34]}")
        if fold:
            below.append(wd["width"])
    if rows:
        out.append(F_("cta", "INFO", "Primary CTA position",
                      (f"Below the fold at {_ranges(below)}." if below
                       else "Within the first screen at every width.")
                      + " Position is reported, not judged.", rows))

    if r.get("shots"):
        out.append(F_("shots", "INFO", "Screenshots",
                      f"{len(r['shots'])} full-page screenshots — these are the deliverable.",
                      [f"{s['width']:>5}px  {s['path']}" for s in r["shots"]]))
    return out



# ── cross-browser render (Phase 2) ──────────────────────────────────────────
# One width only. Eight widths times three engines would be twenty-four loads
# for very little: breakpoint bugs are a CSS problem the responsive sweep
# already covers, while engine bugs show up at any width.
ENGINES = ("chromium", "firefox", "webkit")
CROSS_W, CROSS_H = 1440, 900

LAYOUT_JS = """() => {
  // Child-index path from <body>, so the same element can be found in another
  // engine's DOM without relying on selectors an engine might not match.
  const path = (el) => {
    const parts = [];
    let n = el;
    while (n && n !== document.body && parts.length < 24) {
      const p = n.parentElement;
      if (!p) break;
      parts.push([...p.children].indexOf(n));
      n = p;
    }
    return parts.reverse().join('/');
  };
  const out = [];
  for (const el of document.querySelectorAll('body *')) {
    const s = getComputedStyle(el);
    if (s.display === 'none' || s.visibility === 'hidden') continue;
    const r = el.getBoundingClientRect();
    if (r.width < 24 || r.height < 12) continue;   // slivers carry no signal
    // A carousel sitting on a different slide in each engine is animation
    // state, not a layout difference. One page reported 342 divergences that
    // were all the same Splide track offset by one slide width.
    const SLIDER = 'splide,swiper,slick,carousel,slider,glide,flickity,marquee,ticker,track,loop-image';
    if (!window.__sliderSel) {
      window.__sliderSel = SLIDER.split(',')
        .map(t => `[class*="${t}"],[id*="${t}"]`).join(',');
    }
    if (el.closest(window.__sliderSel)) continue;
    let cls = '';
    if (typeof el.className === 'string' && el.className.trim()) {
      cls = '.' + el.className.trim().split(/\\s+/).slice(0, 2).join('.');
    }
    out.push({ p: path(el), sel: (el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + cls).slice(0, 60),
               x: Math.round(r.left), w: Math.round(r.width), h: Math.round(r.height),
               text: (el.innerText || '').trim().replace(/\\s+/g, ' ').slice(0, 40) });
    if (out.length >= 700) break;
  }
  return { els: out, docHeight: document.documentElement.scrollHeight,
           docWidth: document.documentElement.scrollWidth };
}"""


# Resource-load failures are worded completely differently by each engine
# ("net::ERR_NAME_NOT_RESOLVED" vs "NS_ERROR_..."), so comparing their text
# across engines reports every one of them as engine-specific. They are dropped
# here because the failed-request check already covers them on a signal that IS
# engine-neutral: the URL.
_NET_NOISE = ("failed to load resource", "net::err", "ns_error", "not allowed to load",
              "loading failed for the", "was blocked", "cross-origin",
              "content security policy")


def _norm_msg(t: str) -> str | None:
    """An engine-neutral signature for a console error, or None to ignore it."""
    t = (t or "").strip()
    m = re.search(r'\[JavaScript Error: "(.*?)"', t)   # Firefox wraps its errors
    if m:
        t = m.group(1)
    low = t.lower()
    if any(n in low for n in _NET_NOISE):
        return None
    low = re.sub(r"https?://\S+", "<url>", low)
    low = re.sub(r"\d+", "#", low)
    # Chromium prefixes the error type, Firefox does not. Without stripping it,
    # one identical TypeError looks like a bug unique to each engine.
    low = re.sub(r"^(uncaught\s+)?[a-z]*error:\s*", "", low)
    # Quoted names collapse five "Cookie X rejected" messages into one finding.
    low = re.sub(r"[\"'\u201c\u201d\u2018\u2019][^\"'\u201c\u201d\u2018\u2019]{1,40}[\"'\u201c\u201d\u2018\u2019]", "<q>", low)
    return re.sub(r"\s+", " ", low).strip()[:120] or None


def _norm_url(u: str) -> str:
    """Host and path with ids stripped. The query string is dropped entirely —
    a per-load GUID in it made one failing request look like three separate
    engine-specific failures."""
    p = urlsplit(u)
    path = re.sub(r"/[0-9a-f]{8,}", "/<id>", p.path or "", flags=re.I)
    # Nonces are not always hex: Cloudflare's challenge paths carry long
    # mixed-case tokens that differ on every load.
    path = re.sub(r"/[A-Za-z0-9_-]{16,}", "/<id>", path)
    return (p.netloc + re.sub(r"\d{4,}", "<n>", path))[:120]


def run_cross(pw, url: str, outdir: Path) -> dict:
    """Same page in all three engines. A missing engine is a reported outcome,
    never a crash — Firefox and WebKit have to be installed separately."""
    started = time.time()
    out: dict = {"engines": {}, "shots": [], "elapsed": 0.0}
    target = with_params(url)

    for name in ENGINES:
        t0 = time.time()
        rec: dict = {"outcome": "ok", "console": [], "failed": [], "layout": None,
                     "blocked": 0, "error": None}
        browser = None
        try:
            browser = getattr(pw, name).launch()
        except (PWError, PWTimeout) as exc:
            msg = str(exc)
            rec["outcome"] = "not_installed" if "install" in msg.lower() else "launch_failed"
            rec["error"] = msg[:200]
            rec["elapsed"] = round(time.time() - t0, 1)
            out["engines"][name] = rec
            continue
        try:
            ctx = browser.new_context(user_agent=UA, viewport={"width": CROSS_W, "height": CROSS_H},
                                      device_scale_factor=1, locale="en-AU")
            ctx.set_default_timeout(20000)
            blocked: set[str] = set()
            # Same non-negotiable as everywhere else: three more engines is three
            # more chances to land a hit in a client's analytics.
            ctx.route(COLLECTOR_RX, lambda rt, req, b=blocked: (b.add(req.url), rt.abort()))
            page = ctx.new_page()
            page.on("requestfinished", lambda rq, r=rec: r.setdefault("hits", []).append(
                rq.url[:200]) if COLLECTOR_RX.search(rq.url) else None)
            page.on("console", lambda m, r=rec: r["console"].append(m.text[:300])
                    if m.type == "error" else None)
            page.on("requestfailed", lambda rq, r=rec, b=blocked: r["failed"].append(
                {"url": rq.url[:200], "why": (rq.failure or "")[:80]}) if rq.url not in b else None)
            page.goto(target, wait_until="domcontentloaded", timeout=40000)
            try:
                page.wait_for_load_state("networkidle", timeout=12000)
            except PWTimeout:
                pass
            page.wait_for_timeout(2500)
            rec["layout"] = _eval(page.main_frame, LAYOUT_JS, None)
            rec["blocked"] = len(blocked)
            shot = outdir / f"engine-{name}.png"
            try:
                page.screenshot(path=str(shot), full_page=False)
                out["shots"].append({"engine": name, "path": str(shot)})
            except PWError as exc:
                rec["error"] = f"screenshot: {str(exc)[:120]}"
            ctx.close()
        except (PWError, PWTimeout) as exc:
            rec["outcome"] = "load_failed"
            rec["error"] = f"{type(exc).__name__}: {str(exc)[:180]}"
        finally:
            try:
                browser.close()
            except PWError:
                pass
        rec["elapsed"] = round(time.time() - t0, 1)
        out["engines"][name] = rec

    out["elapsed"] = round(time.time() - started, 1)
    return out


def cross_findings(c: dict) -> list[dict]:
    eng = c.get("engines") or {}
    ok = [n for n, r in eng.items() if r["outcome"] == "ok"]
    out: list[dict] = []

    missing = [n for n, r in eng.items() if r["outcome"] != "ok"]
    if missing:
        out.append(F("engines", "SKIP", "Browser engines",
                     f"{len(missing)} engine(s) could not run — not a page problem.",
                     [f"{n}: {eng[n]['outcome']}  {(eng[n].get('error') or '')[:90]}"
                      for n in missing]))
    if len(ok) < 2:
        return out

    # Console errors. An error in one engine is a compatibility bug; the same
    # error everywhere is a page bug the responsive pass would also have seen.
    groups: dict[str, set] = {}
    sample: dict[str, str] = {}
    for n in ok:
        for m in eng[n]["console"]:
            k = _norm_msg(m)
            if k is None:
                continue
            groups.setdefault(k, set()).add(n)
            sample.setdefault(k, m)
    only = {k: v for k, v in groups.items() if len(v) == 1}
    everywhere = {k: v for k, v in groups.items() if len(v) == len(ok)}
    if only:
        out.append(F("engine-console", "WARN", "Engine-specific console errors",
                     f"{len(only)} error(s) appear in one engine only — this is what "
                     "cross-browser testing is for.",
                     [f"{list(v)[0]:9} {sample[k][:96]}" for k, v in list(only.items())[:6]]))
    else:
        out.append(F("engine-console", "PASS", "Engine-specific console errors",
                     "No console error is unique to one engine."))
    if everywhere:
        out.append(F("all-console", "INFO", "Console errors in every engine",
                     f"{len(everywhere)} error(s) occur in all {len(ok)} engines — a page "
                     "bug, not a compatibility bug.",
                     [sample[k][:100] for k in list(everywhere)[:4]]))

    # Failed requests, same rule.
    rgroups: dict[str, set] = {}
    for n in ok:
        for f_ in eng[n]["failed"]:
            rgroups.setdefault(_norm_url(f_["url"]), set()).add(n)
    ronly = {k: v for k, v in rgroups.items() if len(v) == 1}
    if ronly:
        out.append(F("engine-requests", "WARN", "Engine-specific failed requests",
                     f"{len(ronly)} request(s) fail in one engine only.",
                     [f"{list(v)[0]:9} {k[:96]}" for k, v in list(ronly.items())[:6]]))
    else:
        out.append(F("engine-requests", "PASS", "Engine-specific failed requests",
                     "No request fails in only one engine."))

    # Layout divergence against Chromium. Vertical offsets are deliberately not
    # compared: one element rendering 30px taller pushes everything below it
    # down, which would report a hundred symptoms of a single cause. Size and
    # horizontal position do not cascade that way.
    base_name = "chromium" if "chromium" in ok else ok[0]
    base = (eng[base_name].get("layout") or {}).get("els") or []
    bmap = {e["p"]: e for e in base}
    rows, worst = [], 0
    for n in ok:
        if n == base_name:
            continue
        lay = (eng[n].get("layout") or {}).get("els") or []
        for e in lay:
            b = bmap.get(e["p"])
            if not b:
                continue
            dw, dh, dx = e["w"] - b["w"], e["h"] - b["h"], e["x"] - b["x"]
            span = max(abs(dw), abs(dh), abs(dx))
            # Font metrics differ between engines, so small deltas are normal.
            # Require both an absolute and a relative gap before calling it.
            rel = span / max(1, max(b["w"], b["h"]))
            if span < 16 or rel < 0.04:
                continue
            worst = max(worst, span)
            rows.append((span, n, dw, dh, dx, b["sel"][:36], (b["text"] or "")[:22]))
    heights = {n: (eng[n].get("layout") or {}).get("docHeight") for n in ok}
    if rows:
        # Elements sharing an identical delta are one cause, not many findings:
        # a container that renders wider pushes every child by the same amount.
        groups: dict[tuple, list] = {}
        for span, n, dw, dh, dx, sel_, text in rows:
            groups.setdefault((n, dw, dh, dx), []).append((span, sel_, text))
        ranked = sorted(groups.items(), key=lambda kv: -max(x[0] for x in kv[1]))
        ev = []
        for (n, dw, dh, dx), members in ranked[:8]:
            ex = members[0]
            ev.append(f"{n:8} {len(members):>4} el  dw{dw:+5} dh{dh:+5} dx{dx:+5}  "
                      f"e.g. {ex[1]:34} {ex[2]!r}")
        out.append(F("layout-diff", "WARN", "Layout divergence",
                     f"{len(rows)} element(s) in {len(groups)} distinct shift(s) differ from "
                     f"{base_name} by more than 16px (worst {worst}px). Confirm against the "
                     "engine screenshots.",
                     ev + [f"page height  " + "  ".join(f"{k}={v}" for k, v in heights.items())]))
    else:
        out.append(F("layout-diff", "PASS", "Layout divergence",
                     "No element differs from " + base_name + " beyond tolerance.",
                     [f"page height  " + "  ".join(f"{k}={v}" for k, v in heights.items())]))

    if c.get("shots"):
        out.append(F("engine-shots", "INFO", "Engine screenshots",
                     f"{len(c['shots'])} screenshots at {CROSS_W}px.",
                     [f"{s['engine']:9} {s['path']}" for s in c["shots"]]))
    return out


# ── report ──────────────────────────────────────────────────────────────────

ORDER = {"FAIL": 0, "WARN": 1, "SKIP": 2, "PASS": 3, "INFO": 4}


def counts(rep):
    c = {}
    for f in rep["findings"]:
        c[f["status"]] = c.get(f["status"], 0) + 1
    return c


def render(rep) -> str:
    c = counts(rep)
    head = " · ".join(f"{k} {c[k]}" for k in ("FAIL", "WARN", "PASS", "INFO", "SKIP") if c.get(k))
    plat = rep["platform"] + (f" / {rep['form_plugin']}" if rep["form_plugin"] else "")
    L = ["", "=" * 78, f"  {rep['url']}",
         f"  {plat} · {len(rep['forms'])} form(s) · {rep['elapsed']}s · "
         f"HTTP {rep['status_code']} · {rep['checked_at']}", f"  {head}", "=" * 78, ""]
    for f in sorted(rep["findings"], key=lambda x: ORDER.get(x["status"], 9)):
        L.append(f"  {f['status']:5} {f['title']}")
        L += [f"        {f['detail']}"] if f["detail"] else []
        L += [f"          · {e}" for e in f["evidence"]]
        L.append("")
    L.append(f"  analytics safety: {rep['collectors_blocked']} collector request(s) blocked, "
             f"{len(rep['collector_hits'])} allowed through")
    ph = rep.get("phases") or {}
    if ph:
        L.append("  elapsed: " + " · ".join(f"{k} {v}s" for k, v in ph.items()))
    return "\n".join(L)


def render_summary(reps) -> str:
    L = ["", f"  {'PAGE':<46} {'PLATFORM':<20} {'FAIL':>4} {'WARN':>5}  VERDICT", "  " + "-" * 90]
    for r in reps:
        c = counts(r)
        u = r["url"].replace("https://", "").replace("http://", "")
        verdict = ("cannot verify" if r["outcome"] != "ok" else "genuine problem"
                   if c.get("FAIL") else "worth a look" if c.get("WARN") else "clean")
        L.append(f"  {u[:46]:<46} {r['platform'][:20]:<20} {c.get('FAIL', 0):>4} "
                 f"{c.get('WARN', 0):>5}  {verdict}")
    bad = sum(1 for r in reps if counts(r).get("FAIL"))
    return "\n".join(L + ["  " + "-" * 90,
                          f"  {bad} of {len(reps)} pages have a genuine problem.", ""])


def main() -> int:
    ap = argparse.ArgumentParser(prog="pagecheck", description="Will this page capture the lead?")
    ap.add_argument("urls", nargs="*")
    ap.add_argument("-f", "--file", help="file of URLs, one per line")
    ap.add_argument("--json", action="store_true", help="raw JSON to stdout")
    ap.add_argument("--responsive", action="store_true",
                    help="sweep 8 widths, screenshot each (adds ~8 page loads per URL)")
    ap.add_argument("--browsers", action="store_true",
                    help="render in Chromium, Firefox and WebKit at 1440 and compare")
    ap.add_argument("--out", help="directory for screenshots and JSON "
                                  "(default: pagecheck-runs/<timestamp>)")
    args = ap.parse_args()

    urls = list(args.urls)
    if args.file:
        with open(args.file) as fh:
            urls += [ln.strip() for ln in fh if ln.strip() and not ln.startswith("#")]
    urls = list(dict.fromkeys(urls))
    if not urls:
        ap.error("give at least one URL")

    base: Path | None = None
    if args.responsive or args.browsers or args.out:
        base = Path(args.out) if args.out else (
            Path("pagecheck-runs") / datetime.now().strftime("%Y%m%d-%H%M%S"))
        base.mkdir(parents=True, exist_ok=True)

    reports = []
    with sync_playwright() as pw:
        browser = pw.chromium.launch(args=["--disable-blink-features=AutomationControlled"])
        for u in urls:  # one site at a time, deliberately
            if not args.json:
                print(f"  checking {u} …", file=sys.stderr)
            outdir = None
            if base is not None and (args.responsive or args.browsers):
                slug = re.sub(r"[^a-z0-9.-]+", "-",
                              (urlparse(with_params(u)).netloc + urlparse(u).path).lower()).strip("-")
                outdir = base / (slug[:60] or "page")
                outdir.mkdir(parents=True, exist_ok=True)
            try:
                reports.append(check_url(browser, u, outdir, pw=pw,
                                         responsive=args.responsive, cross=args.browsers))
            except Exception as exc:  # a bad page is a result, not a crash
                reports.append({"url": u, "outcome": "error", "platform": "Unknown",
                                "form_plugin": None, "status_code": None, "final_url": None,
                                "elapsed": 0, "checked_at": "", "forms": [], "collector_hits": [],
                                "collectors_blocked": 0,
                                "findings": [F("load", "SKIP", "Page load",
                                               f"{type(exc).__name__}: {exc}"[:300])]})
        browser.close()

    # Results are written to disk so a run does not evaporate between sessions.
    if base is not None:
        (base / "report.json").write_text(json.dumps(reports, indent=2), encoding="utf-8")
        if not args.json:
            print(f"\n  run written to {base}/report.json", file=sys.stderr)

    if args.json:
        print(json.dumps(reports if len(reports) > 1 else reports[0], indent=2))
    else:
        print(render_summary(reports)) if len(reports) > 1 else None
        for r in reports:
            print(render(r))
    return 1 if any(counts(r).get("FAIL") for r in reports) else 0


if __name__ == "__main__":
    sys.exit(main())
