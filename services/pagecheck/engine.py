"""Pagecheck — the check engine.

Answers one question about a landing page: will it actually capture leads and
their attribution, or is it silently losing them?

The whole engine lives here. The web app and the CLI are both thin callers of
`check_page()` — one implementation, never two.

Read-only. It never submits a form.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field as dc_field, asdict
from typing import Any, Callable, Iterable
from urllib.parse import urlencode, urlparse, urlunparse, parse_qsl

# ── Probe parameters ────────────────────────────────────────────────────────
TEST_PARAMS: dict[str, str] = {
    "utm_source": "qa", "utm_medium": "qa", "utm_campaign": "qa",
    "utm_term": "qa", "utm_content": "qa",
    "gclid": "QA_TEST_GCLID", "fbclid": "QA_TEST_FBCLID",
}
LATE_DELAY_S = 3.0
DEFAULT_TIMEOUT_MS = 30_000
NETWORK_IDLE_MS = 8_000
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36")

PASS, FAIL, WARN, INFO = "PASS", "FAIL", "WARN", "INFO"


# ── Platform fingerprints ───────────────────────────────────────────────────
# Infrastructure hosts only, never a brand word. A page that SAYS "we build
# gohighlevel funnels" is not a GoHighLevel page, and the wrong platform means
# every quirk below it is interpreted wrongly.
PLATFORMS: list[tuple[str, tuple[str, ...]]] = [
    ("Unbounce",     ("lp-pom", "ub-emb", "unbouncepages.com", "ubembed.com")),
    ("ClickFunnels", ("clickfunnels", "containerwrapper", "data-page-element")),
    ("GoHighLevel",  ("leadconnectorhq", "msgsndr", "app.gohighlevel.com")),
    ("Kajabi",       ("kajabi-cdn", "kajabi-theme", "kjb-")),
    ("HubSpot",      ("hs-scripts", "hsforms.net", "hubspotusercontent")),
    ("Webflow",      ("data-wf-page", "data-wf-site", "website-files.com")),
    ("Squarespace",  ("squarespace-cdn", "static1.squarespace")),
    ("Shopify",      ("cdn.shopify", "myshopify.com", "/cdn/shop/")),
    ("WordPress",    ("/wp-content/", "/wp-includes/", "wp-json")),
]
WP_PLUGINS: list[tuple[str, tuple[str, ...]]] = [
    ("Gravity Forms", ("gform_", "gravityforms")),
    ("WPForms", ("wpforms-", "wpforms_")),
    ("Elementor Forms", ("elementor-field", "elementor-form")),
    ("Contact Form 7", ("wpcf7",)),
    ("Ninja Forms", ("nf-form", "ninja-forms")),
    ("Formidable", ("frm_form", "formidable")),
]

# ── Attribution field naming ────────────────────────────────────────────────
CANONICAL = ["utm_source", "utm_medium", "utm_campaign", "utm_term",
             "utm_content", "gclid", "fbclid"]
ALIASES: dict[str, tuple[str, ...]] = {
    "utm_source": ("utmsource", "source", "trafficsource", "ubutmsource"),
    "utm_medium": ("utmmedium", "medium", "ubutmmedium"),
    "utm_campaign": ("utmcampaign", "campaign", "campaignname", "ubutmcampaign"),
    "utm_term": ("utmterm", "term", "keyword", "ubutmterm"),
    "utm_content": ("utmcontent", "content", "adcontent", "ubutmcontent"),
    "gclid": ("googleclickid", "gclidfield"),
    "fbclid": ("facebookclickid", "fbc"),
}

# Platforms that attribute a lead by cookie, with no hidden field needed.
COOKIE_ATTRIBUTION: dict[str, tuple[str, ...]] = {
    "HubSpot": ("hubspotutk", "__hstc"),
    "Google Ads": ("_gcl_aw", "gcl_aw_p", "_gac_"),
    "Meta": ("_fbc",),
    "Google Analytics": ("_ga",),
}

# ── Non-production signals ──────────────────────────────────────────────────
STAGING_MARKERS = ("staging", "-stage", "test", "dev.", ".dev", "localhost",
                   "127.0.0.1", "sandbox", "preprod", "uat")
# A builder's own collector means the lead may never reach the client's stack.
DEFAULT_COLLECTORS = ("formspree.io", "unbouncepages.com", "getform.io",
                      "formsubmit.co", "usebasin.com", "mailerlite.com",
                      "eocampaign1.com", "emailoctopus.com", "list-manage.com",
                      "activehosted.com", "hsforms.com", "jotform.com",
                      "typeform.com", "tally.so", "convertkit.com")
PLACEHOLDERS = ("lorem ipsum", "headline here", "your text here", "your headline",
                "insert text", "todo", "tbd", "coming soon…", "sample text",
                "example@example.com", "test@test.com", "john@doe.com")
CAPTCHAS: list[tuple[str, tuple[str, ...], str]] = [
    ("reCAPTCHA", ("google.com/recaptcha", "gstatic.com/recaptcha", "g-recaptcha"), "data-sitekey"),
    ("hCaptcha", ("hcaptcha.com", "h-captcha"), "data-sitekey"),
    ("Turnstile", ("challenges.cloudflare.com", "cf-turnstile"), "data-sitekey"),
]

# Consent banners: the accept control, in rough order of specificity.
CONSENT_ACCEPT_SELECTORS = [
    "#onetrust-accept-btn-handler",
    "#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll",
    "#CybotCookiebotDialogBodyButtonAccept",
    ".cc-allow", ".cky-btn-accept", "#hs-eu-confirmation-button",
    "[data-cky-tag='accept-button']", "#truste-consent-button",
    "button[aria-label*='Accept' i]", "button[title*='Accept' i]",
]
CONSENT_ACCEPT_TEXT = ["accept all", "allow all", "accept cookies", "i agree",
                       "agree and close", "accept", "allow", "got it", "ok"]


def _norm(name: str) -> str:
    return re.sub(r"[^a-z0-9]", "", (name or "").lower())


def canonical_for(field_name: str) -> str | None:
    """Which attribution parameter a field is meant to hold, if any."""
    n = _norm(field_name)
    if not n:
        return None
    for canon in CANONICAL:
        if n == _norm(canon):
            return canon
        if any(n == _norm(a) for a in ALIASES.get(canon, ())):
            return canon
    for canon in CANONICAL:
        if _norm(canon) in n:
            return canon
    return None


def build_test_url(url: str) -> str:
    if "://" not in url:
        url = "https://" + url
    p = urlparse(url)
    q = [(k, v) for k, v in parse_qsl(p.query, keep_blank_values=True) if k not in TEST_PARAMS]
    q.extend(TEST_PARAMS.items())
    return urlunparse(p._replace(query=urlencode(q)))


def detect_platform(html: str) -> tuple[str, str]:
    low = html.lower()
    found = [n for n, markers in PLATFORMS if any(m in low for m in markers)]
    if not found:
        return "unknown", ""
    primary, note = found[0], ""
    if "WordPress" in found:
        primary = "WordPress"
        plugins = [p for p, m in WP_PLUGINS if any(x in low for x in m)]
        note = ("form plugin: " + ", ".join(plugins)) if plugins else \
               "no form plugin recognised — hidden field naming is unknown"
    others = [f for f in found if f != primary]
    if others:
        note = (note + "; " if note else "") + "also present: " + ", ".join(others)
    return primary, note


def _is_placeholder_id(tag_id: str) -> bool:
    body = tag_id.split("-", 1)[-1]
    return len(set(body)) <= 1 or "XXXX" in body.upper()


def find_tracking(html: str, requests: list[str] | None = None) -> dict[str, list[str]]:
    """Every tracking ID on the page, read from the source AND the network.

    Source alone is not enough: a tag injected by GTM or a dynamic loader never
    appears in the HTML, so an HTML-only scan reported "no analytics" on a page
    that was demonstrably loading the Meta pixel. Duplicates matter too — two
    GA4 ids double-count conversions and halve reported cost per lead."""
    wire = " ".join(requests or [])
    both = html + " " + wire

    def clean(xs: Iterable[str]) -> list[str]:
        return sorted({x for x in xs if not _is_placeholder_id(x)})

    pixels = set(re.findall(r"fbq\(\s*['\"]init['\"]\s*,\s*['\"](\d{6,})['\"]", html))
    pixels |= set(re.findall(r"facebook\.com/tr[/?][^\s\"']*?\bid=(\d{6,})", both))
    # The pixel SCRIPT loading without an id is its own finding: the tag is on
    # the page but may never fire.
    pixel_script = "connect.facebook.net" in both and "fbevents" in both
    return {
        "gtm": clean(re.findall(r"GTM-[A-Z0-9]{4,}", both)),
        "ga4": clean(re.findall(r"\bG-[A-Z0-9]{6,}\b", both)),
        "meta_pixel": sorted(pixels),
        "meta_script_only": [] if pixels or not pixel_script else ["connect.facebook.net"],
    }


def detect_captcha(html: str) -> dict[str, Any] | None:
    low = html.lower()
    for name, markers, key_attr in CAPTCHAS:
        if any(m in low for m in markers):
            has_key = bool(
                re.search(key_attr + r"\s*=\s*['\"][^'\"]{8,}", html, re.I)
                # v3/invisible: the key is in the script URL or the execute call.
                or re.search(r"recaptcha/api\.js\?[^'\"]*render=([\w-]{20,})", html, re.I)
                or re.search(r"grecaptcha\.(?:execute|render)\s*\(\s*['\"]([\w-]{20,})", html, re.I)
                or re.search(r"turnstile\.render\s*\([^)]*sitekey", html, re.I))
            return {"kind": name, "site_key_present": has_key}
    return None


def find_placeholders(text: str) -> list[str]:
    low = text.lower()
    hits = [p for p in PLACEHOLDERS if p in low]
    if re.search(r"\b555[-.\s]?\d{3}[-.\s]?\d{4}\b", text):
        hits.append("555 phone number")
    return sorted(set(hits))


def classify_action(action: str | None, page_url: str) -> tuple[str, str] | None:
    """(severity, reason) when a form's destination looks wrong.

    The staging test reads the destination HOST, not the whole URL: a live page
    posting to staging.acme.com is exactly the failure worth catching, and a
    naive "is the site's domain in the string" guard silently excused it
    (staging.acme.com contains acme.com). Path segments are excluded too, or
    every /test-drive/ form would be flagged."""
    if not action:
        return None
    a = action.lower()
    host = (urlparse(a if "://" in a else f"https://{a}").hostname or "")
    page_host = (urlparse(page_url).hostname or "").lower()

    if host and host != page_host:
        labels = host.split(".")
        if any(m.strip(".") in labels or host.startswith(m) for m in STAGING_MARKERS):
            return (FAIL, f"posts to {host}, which looks like a staging or test endpoint")
    for c in DEFAULT_COLLECTORS:
        if c in host:
            return (WARN, f"posts to {c}, a builder's default collector rather than "
                          "the client's own system")
    return None


def detect_cookie_attribution(cookies: list[dict[str, Any]]) -> list[str]:
    names = [str(c.get("name", "")).lower() for c in cookies or []]
    return [p for p, markers in COOKIE_ATTRIBUTION.items()
            if any(any(m in n for n in names) for m in markers)]


# ── Browser probes ──────────────────────────────────────────────────────────
COLLECT_JS = r"""
() => {
  const readValue = (el) => { try { return el.value == null ? "" : String(el.value); } catch (e) { return ""; } };
  const isHidden = (el) => {
    try {
      if ((el.type || "").toLowerCase() === "hidden") return true;
      const s = window.getComputedStyle(el);
      if (s.display === "none" || s.visibility === "hidden" || s.opacity === "0") return true;
      const r = el.getBoundingClientRect();
      return r.width === 0 && r.height === 0;
    } catch (e) { return false; }
  };
  const describe = (el) => ({
    name: el.name || el.id || "", type: ((el.type || el.tagName || "").toLowerCase()),
    hidden: isHidden(el), value: readValue(el),
  });
  const SEL = "input,select,textarea";
  const forms = Array.prototype.slice.call(document.querySelectorAll("form")).map((f, i) => ({
    index: i, id: f.id || null, action: f.getAttribute("action") || null,
    method: (f.getAttribute("method") || "get").toLowerCase(),
    className: (typeof f.className === "string" ? f.className : "") || "",
    fields: Array.prototype.slice.call(f.querySelectorAll(SEL)).map(describe),
  }));
  const orphans = Array.prototype.slice.call(document.querySelectorAll(SEL))
    .filter((el) => !el.closest("form")).map(describe);
  return { frameUrl: location.href, forms: forms, orphans: orphans, text: document.body ? document.body.innerText : "" };
}
"""

STORAGE_JS = r"""
() => {
  const dump = (s) => { const o = {}; try { for (let i=0;i<s.length;i++){const k=s.key(i); o[k]=s.getItem(k);} } catch(e){} return o; };
  let ub = null;
  try { if (window.ub && window.ub.page) ub = { variantId: window.ub.page.variantId || null }; } catch (e) {}
  return { local: dump(window.localStorage), session: dump(window.sessionStorage), ub: ub };
}
"""

ROBOTS_JS = r"""
() => {
  const m = document.querySelector('meta[name="robots"], meta[name="googlebot"]');
  return m ? (m.getAttribute("content") || "") : "";
}
"""


# ── Result model ────────────────────────────────────────────────────────────
@dataclass
class Check:
    id: str
    name: str
    status: str
    detail: str
    # Evidence is the product: field values, the console error, the dead
    # request. A "field empty" line alone is not actionable.
    evidence: list[str] = dc_field(default_factory=list)


@dataclass
class Report:
    url: str
    tested_url: str = ""
    outcome: str = "ok"          # ok | load_failed | timeout | no_form
    error: str = ""
    platform: str = "unknown"
    platform_note: str = ""
    checks: list[Check] = dc_field(default_factory=list)
    forms: list[dict[str, Any]] = dc_field(default_factory=list)
    tracking: dict[str, list[str]] = dc_field(default_factory=dict)
    cookie_attribution: list[str] = dc_field(default_factory=list)
    storage_hits: list[str] = dc_field(default_factory=list)
    consent_diff: dict[str, Any] = dc_field(default_factory=dict)
    console_errors: list[str] = dc_field(default_factory=list)
    failed_requests: list[str] = dc_field(default_factory=list)

    def add(self, cid: str, name: str, status: str, detail: str,
            evidence: list[str] | None = None) -> None:
        self.checks.append(Check(cid, name, status, detail, evidence or []))

    @property
    def failed(self) -> bool:
        return any(c.status == FAIL for c in self.checks) or self.outcome != "ok"

    @property
    def counts(self) -> dict[str, int]:
        out = {PASS: 0, FAIL: 0, WARN: 0, INFO: 0}
        for c in self.checks:
            out[c.status] = out.get(c.status, 0) + 1
        return out


# ── One page load ───────────────────────────────────────────────────────────
@dataclass
class PassResult:
    """Everything one load of the page yielded."""
    html: str = ""
    forms: list[dict[str, Any]] = dc_field(default_factory=list)
    forms_late: list[dict[str, Any]] = dc_field(default_factory=list)
    storage: dict[str, Any] = dc_field(default_factory=dict)
    cookies: list[dict[str, Any]] = dc_field(default_factory=list)
    text: str = ""
    robots: str = ""
    console_errors: list[str] = dc_field(default_factory=list)
    failed_requests: list[str] = dc_field(default_factory=list)
    requests: list[str] = dc_field(default_factory=list)
    consent_clicked: bool = False
    error: str = ""
    outcome: str = "ok"


# Frames that never host a lead form. Skipping them is a speedup, but the
# reason it exists is correctness: an ad or analytics iframe is exactly the
# kind that stalls, and evaluate() has no timeout to save us.
SKIP_FRAME_HOSTS = (
    "googletagmanager.com", "google-analytics.com", "doubleclick.net",
    "googlesyndication.com", "google.com/recaptcha", "gstatic.com",
    "facebook.com", "facebook.net", "connect.facebook", "hotjar",
    "player.vimeo.com", "youtube.com/embed", "youtube-nocookie",
    "clarity.ms", "service_worker",
)


def _skip_frame(frame, is_main: bool) -> bool:
    if is_main:
        return False
    try:
        if frame.is_detached():
            return True
        url = (frame.url or "").strip()
    except Exception:
        return True
    # A frame with no URL has no execution context and never will — calling
    # evaluate() on one blocks FOREVER, which hung whole runs on real pages.
    if not url or url == "about:blank":
        return True
    return any(h in url for h in SKIP_FRAME_HOSTS)


def _collect_frames(page) -> tuple[list[dict[str, Any]], str]:
    """Every form in every frame. Cross-origin iframes are the whole point —
    a GoHighLevel form lives in one and same-document JS cannot read it, so
    cross-origin frames are traversed; only frames that cannot hold a form
    are skipped."""
    out: list[dict[str, Any]] = []
    text_parts: list[str] = []
    for frame in page.frames:
        is_main = frame is page.main_frame
        if _skip_frame(frame, is_main):
            continue
        try:
            data = frame.evaluate(COLLECT_JS)
        except Exception:
            continue
        where = "main" if is_main else (data.get("frameUrl") or "iframe")
        for form in data.get("forms", []):
            form["frame"], form["in_iframe"] = where, not is_main
            out.append(form)
        if data.get("orphans"):
            out.append({"index": -1, "id": None, "action": None, "method": "",
                        "className": "", "fields": data["orphans"], "frame": where,
                        "in_iframe": not is_main, "orphan_group": True})
        if data.get("text"):
            text_parts.append(data["text"])
    return out, "\n".join(text_parts)


ACCEPT_JS = r"""
(labels) => {
  // One evaluation instead of dozens of locator round-trips: on a large DOM
  // that difference is minutes, and it was hanging the run outright.
  const KNOWN = ["#onetrust-accept-btn-handler",
    "#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll",
    "#CybotCookiebotDialogBodyButtonAccept", ".cc-allow", ".cky-btn-accept",
    "#hs-eu-confirmation-button", "[data-cky-tag='accept-button']",
    "#truste-consent-button"];
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) return false;
    const s = getComputedStyle(el);
    return s.visibility !== "hidden" && s.display !== "none" && s.opacity !== "0";
  };
  for (const sel of KNOWN) {
    const el = document.querySelector(sel);
    if (el && visible(el)) { el.click(); return sel; }
  }
  const clickable = document.querySelectorAll("button,[role=button],a.cc-btn,input[type=button]");
  for (const el of clickable) {
    const t = (el.innerText || el.value || "").trim().toLowerCase();
    if (!t || t.length > 24) continue;
    if (labels.includes(t) && visible(el)) { el.click(); return t; }
  }
  return null;
}
"""


def _accept_consent(page, wait_ms: int = 5000) -> bool:
    """Click the consent banner's accept control. Best-effort and read-only —
    a consent click is not a form submission.

    Polls, because consent banners are injected by a third-party script and
    commonly render AFTER network idle; a single look reported "no cookie
    banner" on pages that visibly had one, silently disabling the whole
    consent-divergence comparison. Each poll is ONE evaluation — the earlier
    per-label locator queries were slow enough to hang a large page."""
    remaining, step = wait_ms, 700
    while remaining > 0:
        try:
            if page.evaluate(ACCEPT_JS, CONSENT_ACCEPT_TEXT):
                page.wait_for_timeout(700)
                return True
        except Exception:
            pass
        page.wait_for_timeout(step)
        remaining -= step
    return False


def _one_pass(browser, url: str, accept_consent: bool, timeout_ms: int,
              delay_s: float) -> PassResult:
    from playwright.sync_api import Error as PWError, TimeoutError as PWTimeout

    res = PassResult()
    context = browser.new_context(user_agent=UA, viewport={"width": 1280, "height": 900})
    page = context.new_page()

    page.on("request", lambda r: res.requests.append(r.url[:300])
            if len(res.requests) < 400 else None)
    page.on("console", lambda m: res.console_errors.append(
        f"{m.text[:180]}"[:200]) if m.type == "error" else None)
    page.on("requestfailed", lambda r: res.failed_requests.append(
        f"{r.url[:160]} ({(r.failure or {}).get('errorText', 'failed') if isinstance(r.failure, dict) else 'failed'})"))
    page.on("response", lambda r: res.failed_requests.append(f"{r.url[:160]} (HTTP {r.status})")
            if r.status >= 400 else None)

    try:
        try:
            page.goto(url, wait_until="domcontentloaded", timeout=timeout_ms)
        except PWTimeout:
            res.outcome, res.error = "timeout", f"page did not load within {timeout_ms // 1000}s"
            return res
        except PWError as e:
            res.outcome = "load_failed"
            res.error = f"{type(e).__name__}: {str(e).splitlines()[0][:200]}"
            return res

        try:
            page.wait_for_load_state("networkidle", timeout=NETWORK_IDLE_MS)
        except Exception:
            pass

        if accept_consent:
            res.consent_clicked = _accept_consent(page)
            try:
                page.wait_for_load_state("networkidle", timeout=4000)
            except Exception:
                pass

        res.forms, res.text = _collect_frames(page)
        page.wait_for_timeout(int(delay_s * 1000))
        res.forms_late, late_text = _collect_frames(page)
        res.text = res.text or late_text

        try:
            res.html = page.content()
        except Exception:
            pass
        try:
            res.storage = page.evaluate(STORAGE_JS)
        except Exception:
            res.storage = {"local": {}, "session": {}, "ub": None}
        try:
            res.robots = page.evaluate(ROBOTS_JS) or ""
        except Exception:
            pass
        try:
            res.cookies = context.cookies()
        except Exception:
            pass
        return res
    finally:
        try:
            context.close()
        except Exception:
            pass


# ── Analysis ────────────────────────────────────────────────────────────────
def attribution_map(forms: list[dict[str, Any]]) -> dict[str, list[dict[str, Any]]]:
    found: dict[str, list[dict[str, Any]]] = {}
    for form in forms:
        for f in form.get("fields", []):
            canon = canonical_for(f.get("name", ""))
            if canon:
                found.setdefault(canon, []).append({**f, "frame": form.get("frame", "main")})
    return found


def search_storage(storage: dict[str, Any], cookies: list[dict[str, Any]]) -> list[str]:
    hits, sentinels = [], set(TEST_PARAMS.values())
    for scope in ("local", "session"):
        for k, v in (storage.get(scope) or {}).items():
            if any(s in f"{v}" for s in sentinels):
                hits.append(f"{scope}Storage[{k}]")
    for c in cookies or []:
        if any(s in str(c.get("value", "")) for s in sentinels):
            hits.append(f"cookie[{c.get('name')}]")
    return sorted(set(hits))


def _related_evidence(res: PassResult, *needles: str) -> list[str]:
    """Console errors and dead requests that mention any needle. This is what
    turns "field empty" into "field empty, and utm-capture.js 404s"."""
    out: list[str] = []
    for item in res.console_errors + res.failed_requests:
        low = item.lower()
        if any(n and n.lower() in low for n in needles):
            out.append(item)
    return out[:5]


def check_ssl(url: str, page_loaded: bool) -> tuple[str, str]:
    """Chromium refuses to load a page whose certificate does not verify, so a
    successful https load IS the check. An independent Python check only tests
    whichever CA bundle this machine happens to have, which produced a false
    failure for two sites with perfectly valid certificates."""
    if urlparse(url).scheme != "https":
        return FAIL, "the page is served over plain http"
    if page_loaded:
        return PASS, "served over https with a certificate the browser accepts"
    return WARN, "could not confirm the certificate — the page did not load"


def _evaluate(rep: Report, main: PassResult, other: PassResult | None) -> None:
    """Turn the passes into the report. `main` is the consent-accepted load."""
    forms_now, forms_late = main.forms, main.forms_late or main.forms

    # 1 — platform
    rep.platform, rep.platform_note = detect_platform(main.html)
    rep.add("platform", "Platform", INFO,
            rep.platform + (f" ({rep.platform_note})" if rep.platform_note else ""))
    if rep.platform == "Unbounce":
        variant = ((main.storage or {}).get("ub") or {}).get("variantId")
        rep.add("variant", "Unbounce variant", WARN,
                (f"served variant {variant} — " if variant else "") +
                "A/B variants are served per visit; only the variant served now was checked")

    # 2 — forms
    real = [f for f in forms_late if not f.get("orphan_group")]
    iframed = [f for f in forms_late if f.get("in_iframe")]
    orphan_fields = sum(len(f["fields"]) for f in forms_late if f.get("orphan_group"))
    # A page with no form is a real finding, not a dead end: it may still be
    # noindexed, double-tagged or full of placeholder text, and the reader
    # needs those. Only the form-dependent checks are skipped.
    if not forms_late:
        rep.outcome = "no_form"
        rep.add("forms", "Forms found", FAIL,
                "no form or input anywhere on the page, in any frame — nothing here can "
                "capture a lead",
                _related_evidence(main, "form", "iframe"))
    if forms_late:
        bits = [f"{len(real)} form{'' if len(real) == 1 else 's'}"]
        if iframed:
            bits.append(f"{len(iframed)} inside an embedded widget")
        if orphan_fields:
            bits.append(f"{orphan_fields} field{'' if orphan_fields == 1 else 's'} outside any form")
        rep.add("forms", "Forms found", PASS, ", ".join(bits))
    # Only meaningful when the page HAS forms but none of them is embedded —
    # on a page with no form at all the earlier FAIL already said everything.
    if forms_late and rep.platform == "GoHighLevel" and not iframed:
        rep.add("ghl_iframe", "Embedded form", WARN,
                "no embedded form found — a GoHighLevel form is normally a cross-origin "
                "iframe, so the embed may not have rendered")

    # 3/4 — attribution fields and their values
    map_now, map_late = attribution_map(forms_now), attribution_map(forms_late)
    rep.cookie_attribution = detect_cookie_attribution(main.cookies)
    rep.storage_hits = search_storage(main.storage, main.cookies)

    if not forms_late:
        pass  # no form to carry attribution; the FAIL above already says so
    elif not map_late:
        by_cookie = rep.cookie_attribution
        if by_cookie:
            rep.add("attribution", "Attribution capture", WARN,
                    "no attribution field on any form, but " + ", ".join(by_cookie) +
                    " identify the visitor by cookie and resolve the source themselves — "
                    "a lead routed anywhere else carries nothing",
                    [f"cookie attribution: {', '.join(by_cookie)}"])
        else:
            rep.add("attribution", "Attribution capture", FAIL,
                    "no attribution field on any form, and no ad or analytics platform is "
                    "tracking the visit — nothing is recording where these leads come from",
                    _related_evidence(main, "utm", "gclid", "attribution"))
    else:
        empty, late = [], []
        for canon, fields in map_late.items():
            want = TEST_PARAMS[canon]
            if any(want in (f.get("value") or "") for f in map_now.get(canon, [])):
                continue
            (late if any(want in (f.get("value") or "") for f in fields) else empty).append(canon)
        ev = [f"{f['name']} = {f.get('value') or '(empty)'}"
              for fs in map_late.values() for f in fs][:12]
        if empty:
            rep.add("attribution", "Attribution capture", FAIL,
                    f"field(s) exist but stayed empty: {', '.join(sorted(empty))} — the form "
                    "submits, leads arrive, and the campaign is lost",
                    ev + _related_evidence(main, "utm", "gclid", "capture"))
        else:
            missing = [c for c in CANONICAL if c not in map_late]
            rep.add("attribution", "Attribution capture", WARN if missing else PASS,
                    (f"captured; not present: {', '.join(missing)}" if missing
                     else f"all {len(map_late)} attribution field(s) captured"), ev)
        if late:
            rep.add("timing", "Population timing", WARN,
                    f"{', '.join(sorted(late))} was empty on load and filled by the "
                    f"{LATE_DELAY_S:g}s re-read — a fast submitter loses it", ev)

    # 5 — storage fallback
    if rep.storage_hits and not map_late:
        rep.add("storage", "Stored in the browser", INFO,
                "the campaign values were stored in the browser, so some setups attach them "
                "at submit time — which a read-only check cannot confirm", rep.storage_hits[:8])

    # 6 — where the form posts
    for form in (real if forms_late else []):
        verdict = classify_action(form.get("action"), rep.url)
        if verdict:
            sev, why = verdict
            rep.add("endpoint", "Form destination", sev, why, [str(form.get("action"))])
            break
    else:
        actions = [f.get("action") for f in real if f.get("action")]
        page_host = (urlparse(rep.url).hostname or "").lower()
        offsite = sorted({h for a in actions
                          if (h := (urlparse(a if "://" in a else f"https://{a}").hostname or "").lower())
                          and h != page_host})
        if offsite:
            rep.add("endpoint", "Form destination", WARN,
                    "submits to " + ", ".join(offsite) + " rather than the site's own domain — "
                    "confirm the client actually controls that destination",
                    [str(a) for a in actions][:4])
        else:
            rep.add("endpoint", "Form destination", PASS if actions else INFO,
                    "posts to the site's own domain" if actions
                    else "no form action attribute — the page submits with its own script",
                    [str(a) for a in actions][:4])

    # 7 — anti-spam
    cap = detect_captcha(main.html)
    if cap:
        ok = cap["site_key_present"]
        rep.add("captcha", "Anti-spam", PASS if ok else FAIL,
                f"{cap['kind']} present with a site key" if ok else
                f"{cap['kind']} is on the page but no site key was found — this can block "
                "every submission while the page looks fine",
                _related_evidence(main, "recaptcha", "hcaptcha", "turnstile"))
    else:
        rep.add("captcha", "Anti-spam", INFO, "no captcha on this page")

    # 8 — tracking inventory
    rep.tracking = find_tracking(main.html, main.requests)
    script_only = rep.tracking.pop("meta_script_only", [])
    dupes = [f"{len(v)}× {k.upper()}" for k, v in rep.tracking.items() if len(v) > 1]
    ids = [f"{k.upper()}: {', '.join(v)}" for k, v in rep.tracking.items() if v]
    if dupes:
        rep.add("tracking", "Tracking tags", WARN,
                "more than one of the same tag is installed (" + ", ".join(dupes) +
                ") — duplicates double-count conversions and halve reported cost per lead", ids)
    elif ids:
        rep.add("tracking", "Tracking tags", PASS, "; ".join(ids))
    elif script_only:
        rep.add("tracking", "Tracking tags", WARN,
                "the Meta pixel script loads but no pixel ID was ever set — the tag is on the "
                "page and may never actually record anything", script_only)
    else:
        rep.add("tracking", "Tracking tags", WARN, "no analytics or ad tag found on this page")

    # 9 — consent divergence: the signature finding
    if other is not None:
        diff = _consent_diff(main, other)
        rep.consent_diff = diff
        if diff.get("unavailable"):
            rep.add("consent", "Consent divergence", INFO, diff["unavailable"])
        elif diff["fields_differ"] or diff["tags_differ"]:
            what = []
            if diff["fields_differ"]:
                what.append(f"{len(diff['fields_differ'])} attribution field(s)")
            if diff["tags_differ"]:
                what.append("tracking tags")
            rep.add("consent", "Consent divergence", FAIL,
                    "this page behaves differently before the cookie banner is accepted — " +
                    " and ".join(what) + " change — so every visitor who ignores the banner "
                    "arrives with different (or missing) data",
                    [f"{k}: accepted={v['accepted'] or '(empty)'} · ignored={v['ignored'] or '(empty)'}"
                     for k, v in diff["fields_differ"].items()][:8])
        else:
            rep.add("consent", "Consent divergence", PASS,
                    "attribution and tags behave the same whether or not the banner is accepted")

    # 10 — placeholders
    ph = find_placeholders(main.text or "")
    rep.add("placeholder", "Placeholder content", FAIL if ph else PASS,
            "unreplaced placeholder text is visible on the page" if ph
            else "no placeholder text found", ph)

    # 11 — production hygiene
    robots = (main.robots or "").lower()
    if "noindex" in robots or "nofollow" in robots:
        rep.add("robots", "Search visibility", FAIL,
                f"this live page asks search engines to stay away (robots: {robots})", [robots])
    else:
        rep.add("robots", "Search visibility", PASS, "the page is indexable")
    ssl_status, ssl_detail = check_ssl(rep.tested_url or rep.url, bool(main.html))
    rep.add("ssl", "Certificate", ssl_status, ssl_detail)
    mixed = [r for r in main.failed_requests if r.startswith("http://")]
    if mixed:
        rep.add("mixed", "Mixed content", WARN,
                "the page loads resources over plain http, which browsers may block", mixed[:5])

    # 12 — diagnostics, kept as their own line as well as attached above
    rep.console_errors = main.console_errors[:20]
    rep.failed_requests = sorted(set(main.failed_requests))[:20]
    if rep.console_errors or rep.failed_requests:
        rep.add("diagnostics", "Errors during load",
                WARN if rep.console_errors else INFO,
                f"{len(rep.console_errors)} console error(s), "
                f"{len(rep.failed_requests)} failed request(s) while loading",
                (rep.console_errors + rep.failed_requests)[:8])


def _consent_diff(accepted: PassResult, ignored: PassResult) -> dict[str, Any]:
    """What changes between accepting and ignoring the cookie banner. Invisible
    to any single-pass checker, and a real, common, undiagnosed failure."""
    if not accepted.consent_clicked:
        return {"unavailable": "no cookie banner was found, so there is nothing to diverge",
                "fields_differ": {}, "tags_differ": False}
    a_fields = {k: (v[0].get("value") or "") for k, v in
                attribution_map(accepted.forms_late or accepted.forms).items() if v}
    i_fields = {k: (v[0].get("value") or "") for k, v in
                attribution_map(ignored.forms_late or ignored.forms).items() if v}
    differ = {k: {"accepted": a_fields.get(k, ""), "ignored": i_fields.get(k, "")}
              for k in set(a_fields) | set(i_fields)
              if a_fields.get(k, "") != i_fields.get(k, "")}
    a_tags = find_tracking(accepted.html, accepted.requests)
    i_tags = find_tracking(ignored.html, ignored.requests)
    return {"fields_differ": differ, "tags_differ": a_tags != i_tags,
            "tags_accepted": a_tags, "tags_ignored": i_tags,
            "banner_found": accepted.consent_clicked}


# ── Entry point ─────────────────────────────────────────────────────────────
def check_page(url: str, timeout_ms: int = DEFAULT_TIMEOUT_MS,
               delay_s: float = LATE_DELAY_S,
               on_progress: Callable[[str], None] | None = None) -> dict[str, Any]:
    """Check one page. Owns its browser; never raises for a bad page — a load
    failure, a timeout and a page with no form are each reported outcomes."""
    from playwright.sync_api import sync_playwright

    say = on_progress or (lambda _m: None)
    rep = Report(url=url, tested_url=build_test_url(url))

    try:
        with sync_playwright() as pw:
            browser = pw.chromium.launch(headless=True)
            try:
                say("Loading the page and accepting the cookie banner")
                accepted = _one_pass(browser, rep.tested_url, True, timeout_ms, delay_s)
                if accepted.outcome != "ok":
                    rep.outcome, rep.error = accepted.outcome, accepted.error
                    return _finish(rep)

                say("Loading again, ignoring the cookie banner")
                ignored = _one_pass(browser, rep.tested_url, False, timeout_ms, delay_s)

                say("Comparing the two loads")
                _evaluate(rep, accepted, ignored if ignored.outcome == "ok" else None)
                rep.forms = accepted.forms_late or accepted.forms
            finally:
                try:
                    browser.close()
                except Exception:
                    pass
    except Exception as e:  # noqa: BLE001 — a bad page is a result, not a crash
        rep.outcome = "load_failed"
        rep.error = f"{type(e).__name__}: {str(e).splitlines()[0][:200]}"

    return _finish(rep)


def _finish(rep: Report) -> dict[str, Any]:
    out = asdict(rep)
    out["failed"] = rep.failed
    out["counts"] = rep.counts
    return out
