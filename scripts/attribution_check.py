#!/usr/bin/env python3
"""Landing page attribution checker.

Give it a URL. It loads the page with test attribution parameters attached and
reports whether the page's forms would actually capture them — or whether leads
arrive with empty UTM fields while the form appears to work perfectly.

The failure it hunts: a hidden field named `utm_source` that exists, submits,
and is empty. The form works. Leads arrive. Attribution is silently dead.

Read-only. It never submits a form.

    python3 attribution_check.py https://example.com/lp
    python3 attribution_check.py --file urls.txt --json
    python3 attribution_check.py https://a.test https://b.test

Exit codes: 0 = no failures, 1 = at least one FAIL, 2 = usage/setup problem.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import dataclass, field as dc_field, asdict
from typing import Any
from urllib.parse import urlencode, urlparse, urlunparse, parse_qsl

# ── Test parameters ─────────────────────────────────────────────────────────
# Distinctive enough to find again in a field value, a cookie or a storage
# blob, without being so exotic that a validator rejects them.
TEST_PARAMS: dict[str, str] = {
    "utm_source": "qa",
    "utm_medium": "qa",
    "utm_campaign": "qa",
    "utm_term": "qa",
    "utm_content": "qa",
    "gclid": "QA_TEST_GCLID",
    "fbclid": "QA_TEST_FBCLID",
}

LATE_PASS_DELAY_S = 3.0
DEFAULT_TIMEOUT_MS = 30_000
NETWORK_IDLE_MS = 8_000

UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36")


# ── Platform fingerprints ───────────────────────────────────────────────────
# Infrastructure markers only — never a bare brand word. A page that SAYS
# "we build gohighlevel funnels" is not a GoHighLevel page, and matching the
# word instead of the platform's own hosts reports the wrong builder (and
# therefore the wrong quirks) with total confidence.
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

# WordPress says nothing about how fields are named — the form plugin does.
WP_PLUGINS: list[tuple[str, tuple[str, ...]]] = [
    ("Gravity Forms",  ("gform_", "gravityforms")),
    ("WPForms",        ("wpforms-", "wpforms_")),
    ("Elementor Forms", ("elementor-field", "elementor-form")),
    ("Contact Form 7", ("wpcf7", "wpcf7-form")),
    ("Ninja Forms",    ("nf-form", "ninja-forms")),
    ("Formidable",     ("frm_form", "formidable")),
]


# ── Attribution field naming ────────────────────────────────────────────────
# Builders rename on injection. Unbounce prefixes, GHL uses its own keys,
# Salesforce-bound forms suffix with __c. Match on a normalised name so a
# field called "UTM Source__c" still counts as utm_source.
CANONICAL = ["utm_source", "utm_medium", "utm_campaign", "utm_term",
             "utm_content", "gclid", "fbclid"]

ALIASES: dict[str, tuple[str, ...]] = {
    "utm_source":   ("utmsource", "source", "utm_source_c", "ubutmsource", "trafficsource"),
    "utm_medium":   ("utmmedium", "medium", "utm_medium_c", "ubutmmedium"),
    "utm_campaign": ("utmcampaign", "campaign", "utm_campaign_c", "ubutmcampaign", "campaignname"),
    "utm_term":     ("utmterm", "term", "keyword", "utm_term_c", "ubutmterm"),
    "utm_content":  ("utmcontent", "content", "adcontent", "utm_content_c", "ubutmcontent"),
    "gclid":        ("googleclickid", "gclid_c", "gclidfield", "glcid"),
    "fbclid":       ("facebookclickid", "fbclid_c", "fbc"),
}


def _norm(name: str) -> str:
    """Lowercase, strip everything that isn't a letter or digit."""
    return re.sub(r"[^a-z0-9]", "", (name or "").lower())


def canonical_for(field_name: str) -> str | None:
    """Which attribution parameter this field is meant to hold, if any."""
    n = _norm(field_name)
    if not n:
        return None
    for canon in CANONICAL:
        if n == _norm(canon):
            return canon
        for alias in ALIASES.get(canon, ()):
            if n == _norm(alias):
                return canon
    # Suffixed/prefixed variants: "hidden_utm_source_1", "lead[utm_source]".
    for canon in CANONICAL:
        if _norm(canon) in n:
            return canon
    return None


# ── Browser-side probes ─────────────────────────────────────────────────────
COLLECT_JS = r"""
() => {
  const readValue = (el) => { try { return el.value == null ? "" : String(el.value); }
                              catch (e) { return ""; } };
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
    name: el.name || el.id || "",
    type: ((el.type || el.tagName || "").toLowerCase()),
    hidden: isHidden(el),
    value: readValue(el),
  });
  const SEL = "input,select,textarea";
  const forms = Array.prototype.slice.call(document.querySelectorAll("form")).map((f, i) => ({
    index: i,
    id: f.id || null,
    name: f.getAttribute("name") || null,
    action: f.getAttribute("action") || null,
    className: (typeof f.className === "string" ? f.className : "") || "",
    fields: Array.prototype.slice.call(f.querySelectorAll(SEL)).map(describe),
  }));
  // Inputs that belong to no <form>. ClickFunnels and several React builders
  // wrap submission themselves and leave the fields outside the element.
  const orphans = Array.prototype.slice.call(document.querySelectorAll(SEL))
    .filter((el) => !el.closest("form")).map(describe);
  return { frameUrl: location.href, forms: forms, orphans: orphans };
}
"""

STORAGE_JS = r"""
() => {
  const dump = (store) => {
    const out = {};
    try { for (let i = 0; i < store.length; i++) { const k = store.key(i); out[k] = store.getItem(k); } }
    catch (e) { /* storage can be blocked */ }
    return out;
  };
  let ub = null;
  try {
    if (window.ub && window.ub.page) {
      ub = { variantId: window.ub.page.variantId || null, pageId: window.ub.page.id || null };
    }
  } catch (e) { /* not Unbounce */ }
  return { local: dump(window.localStorage), session: dump(window.sessionStorage), ub: ub };
}
"""


# ── Result model ────────────────────────────────────────────────────────────
PASS, FAIL, WARN, INFO = "PASS", "FAIL", "WARN", "INFO"


@dataclass
class Check:
    name: str
    status: str
    detail: str


@dataclass
class UrlReport:
    url: str
    tested_url: str = ""
    outcome: str = "ok"          # ok | load_failed | timeout | no_form
    platform: str = "unknown"
    platform_note: str = ""
    checks: list[Check] = dc_field(default_factory=list)
    forms: list[dict[str, Any]] = dc_field(default_factory=list)
    tracking: dict[str, list[str]] = dc_field(default_factory=dict)
    storage_hits: list[str] = dc_field(default_factory=list)
    error: str = ""

    def add(self, name: str, status: str, detail: str) -> None:
        self.checks.append(Check(name, status, detail))

    @property
    def failed(self) -> bool:
        return any(c.status == FAIL for c in self.checks) or self.outcome != "ok"


# ── Helpers ─────────────────────────────────────────────────────────────────
def build_test_url(url: str) -> str:
    """Append the test parameters, overriding any that are already present."""
    if "://" not in url:
        url = "https://" + url
    parts = urlparse(url)
    query = [(k, v) for k, v in parse_qsl(parts.query, keep_blank_values=True)
             if k not in TEST_PARAMS]
    query.extend(TEST_PARAMS.items())
    return urlunparse(parts._replace(query=urlencode(query)))


def detect_platform(html: str) -> tuple[str, str]:
    """(platform, note). Markers are infrastructure, never brand words."""
    low = html.lower()
    found = [name for name, markers in PLATFORMS if any(m in low for m in markers)]
    if not found:
        return "unknown", ""
    primary = found[0]
    note = ""
    if primary == "WordPress" or "WordPress" in found:
        plugins = [p for p, markers in WP_PLUGINS if any(m in low for m in markers)]
        note = ("form plugin: " + ", ".join(plugins)) if plugins else \
               "no form plugin recognised — hidden field naming is unknown"
        primary = "WordPress"
    if len(found) > 1:
        others = [f for f in found if f != primary]
        if others:
            note = (note + "; " if note else "") + "also present: " + ", ".join(others)
    return primary, note


def _is_placeholder(tag_id: str) -> bool:
    """Snippet templates ship literal placeholders — GTM-XXXXXXXX, G-XXXXXXX.
    Reporting one as a live container is worse than reporting nothing."""
    body = tag_id.split("-", 1)[-1]
    return len(set(body)) <= 1 or "XXXX" in body.upper()


def find_tracking(html: str) -> dict[str, list[str]]:
    """Actual container/measurement/pixel IDs, not a yes/no."""
    def uniq(xs: list[str]) -> list[str]:
        return sorted({x for x in xs if not _is_placeholder(x)})

    return {
        "gtm": uniq(re.findall(r"GTM-[A-Z0-9]{4,}", html)),
        "ga4": uniq(re.findall(r"\bG-[A-Z0-9]{6,}\b", html)),
        "meta_pixel": sorted(set(
            re.findall(r"fbq\(\s*['\"]init['\"]\s*,\s*['\"](\d{6,})['\"]", html)
            + re.findall(r"facebook\.com/tr\?id=(\d{6,})", html)
        )),
    }


def collect_fields(page) -> list[dict[str, Any]]:
    """Every form in every frame. Cross-origin iframes are the whole point —
    a GoHighLevel form lives in one, and same-document JS cannot read it."""
    out: list[dict[str, Any]] = []
    for frame in page.frames:
        try:
            data = frame.evaluate(COLLECT_JS)
        except Exception:
            # A frame can vanish mid-traversal, or refuse evaluation.
            continue
        is_main = frame is page.main_frame
        for form in data.get("forms", []):
            form["frame"] = "main" if is_main else data.get("frameUrl", "iframe")
            form["in_iframe"] = not is_main
            out.append(form)
        orphans = data.get("orphans", [])
        if orphans:
            out.append({
                "index": -1, "id": None, "name": None, "action": None,
                "className": "", "fields": orphans,
                "frame": "main" if is_main else data.get("frameUrl", "iframe"),
                "in_iframe": not is_main, "orphan_group": True,
            })
    return out


def attribution_map(forms: list[dict[str, Any]]) -> dict[str, list[dict[str, Any]]]:
    """canonical param -> the fields meant to hold it."""
    found: dict[str, list[dict[str, Any]]] = {}
    for form in forms:
        for f in form.get("fields", []):
            canon = canonical_for(f.get("name", ""))
            if canon:
                found.setdefault(canon, []).append({**f, "form": form.get("frame", "main")})
    return found


def search_storage(storage: dict[str, Any], cookies: list[dict[str, Any]]) -> list[str]:
    """Where a sentinel value turned up outside the form fields."""
    hits: list[str] = []
    sentinels = {v for v in TEST_PARAMS.values()}
    for scope in ("local", "session"):
        for k, v in (storage.get(scope) or {}).items():
            text = f"{v}"
            if any(s in text for s in sentinels):
                hits.append(f"{scope}Storage[{k}]")
    for c in cookies or []:
        if any(s in str(c.get("value", "")) for s in sentinels):
            hits.append(f"cookie[{c.get('name')}]")
    return sorted(set(hits))


# ── The check itself ────────────────────────────────────────────────────────
def check_url(pw, url: str, timeout_ms: int, delay_s: float) -> UrlReport:
    from playwright.sync_api import Error as PWError, TimeoutError as PWTimeout

    rep = UrlReport(url=url)
    rep.tested_url = build_test_url(url)

    browser = pw.chromium.launch(headless=True)
    context = browser.new_context(user_agent=UA, viewport={"width": 1280, "height": 900})
    page = context.new_page()

    try:
        try:
            page.goto(rep.tested_url, wait_until="domcontentloaded", timeout=timeout_ms)
        except PWTimeout:
            rep.outcome = "timeout"
            rep.error = f"page did not load within {timeout_ms // 1000}s"
            return rep
        except PWError as e:
            rep.outcome = "load_failed"
            rep.error = f"{type(e).__name__}: {str(e).splitlines()[0][:200]}"
            return rep

        # Network idle is a courtesy, not a requirement — plenty of pages keep
        # a socket open forever and would otherwise never be checkable.
        try:
            page.wait_for_load_state("networkidle", timeout=NETWORK_IDLE_MS)
        except Exception:
            pass

        html = ""
        try:
            html = page.content()
        except Exception:
            pass

        rep.platform, rep.platform_note = detect_platform(html)
        rep.tracking = find_tracking(html)

        # Pass 1 — immediately after load.
        first = collect_fields(page)
        # Pass 2 — after a delay. Many builders inject late.
        page.wait_for_timeout(int(delay_s * 1000))
        second = collect_fields(page)

        try:
            html2 = page.content()
            merged = find_tracking(html2)
            for k, v in merged.items():
                rep.tracking[k] = sorted(set(rep.tracking.get(k, []) + v))
        except Exception:
            pass

        try:
            storage = page.evaluate(STORAGE_JS)
        except Exception:
            storage = {"local": {}, "session": {}, "ub": None}
        try:
            cookies = context.cookies()
        except Exception:
            cookies = []

        rep.storage_hits = search_storage(storage, cookies)
        rep.forms = second or first

        _evaluate(rep, first, second, storage)
        return rep
    finally:
        try:
            context.close()
            browser.close()
        except Exception:
            pass


def _evaluate(rep: UrlReport, first: list[dict], second: list[dict],
              storage: dict[str, Any]) -> None:
    """Turn the two passes into PASS/FAIL/WARN lines."""
    plat = f"{rep.platform}" + (f" ({rep.platform_note})" if rep.platform_note else "")
    rep.add("Platform", INFO, plat)

    # Platform quirks the reader needs in order to trust the result.
    ub = (storage or {}).get("ub")
    if rep.platform == "Unbounce":
        if ub and ub.get("variantId"):
            rep.add("Unbounce variant", WARN,
                    f"served variant {ub['variantId']} — other A/B variants were NOT checked")
        else:
            rep.add("Unbounce variant", WARN,
                    "A/B variants are served per visit; only the variant served now was checked")

    if not second:
        rep.outcome = "no_form"
        rep.add("Forms found", FAIL, "no form or input found anywhere on the page, in any frame")
        return

    iframe_forms = [f for f in second if f.get("in_iframe")]
    orphan_groups = [f for f in second if f.get("orphan_group")]
    real_forms = [f for f in second if not f.get("orphan_group")]

    desc = f"{len(real_forms)} form(s)"
    if iframe_forms:
        desc += f", {len(iframe_forms)} inside an iframe"
    if orphan_groups:
        n = sum(len(g["fields"]) for g in orphan_groups)
        desc += f", {n} input(s) outside any <form>"
    rep.add("Forms found", PASS, desc)

    if rep.platform == "ClickFunnels" and orphan_groups:
        rep.add("ClickFunnels shape", INFO,
                "fields found outside the <form> element — normal for this builder, counted anyway")
    if rep.platform == "GoHighLevel" and not iframe_forms:
        rep.add("GoHighLevel iframe", WARN,
                "no iframe form found; a GHL form is normally a cross-origin iframe — "
                "the embed may not have rendered")
    if rep.platform == "Kajabi":
        shape = "checkout" if any("checkout" in (f.get("action") or "").lower()
                                  or "checkout" in (f.get("className") or "").lower()
                                  for f in real_forms) else "opt-in"
        rep.add("Kajabi form shape", INFO, f"{shape} form — field naming differs between the two")

    first_map = attribution_map(first)
    second_map = attribution_map(second)

    present = sorted(second_map.keys())
    missing = [c for c in CANONICAL if c not in second_map]

    if not present:
        rep.add("Attribution fields", FAIL,
                "no attribution field exists on any form — nothing on this page is "
                "positioned to carry UTM or click IDs")
    else:
        detail = f"{len(present)} of {len(CANONICAL)} present: {', '.join(present)}"
        if missing:
            detail += f" · missing: {', '.join(missing)}"
        rep.add("Attribution fields", PASS if not missing else WARN, detail)

    # The actual check: do those fields hold the values we sent?
    populated_now, populated_late, empty = [], [], []
    for canon, fields in second_map.items():
        expected = TEST_PARAMS[canon]
        got_late = any(expected in (f.get("value") or "") for f in fields)
        got_first = any(expected in (f.get("value") or "")
                        for f in first_map.get(canon, []))
        if got_first:
            populated_now.append(canon)
        elif got_late:
            populated_late.append(canon)
        else:
            empty.append(canon)

    if not second_map:
        pass  # already failed above
    elif empty:
        names = ", ".join(sorted(empty))
        rep.add("Attribution captured", FAIL,
                f"field(s) exist but stayed EMPTY: {names} — the form submits, "
                f"leads arrive, and attribution is lost")
    else:
        rep.add("Attribution captured", PASS,
                f"all {len(second_map)} attribution field(s) hold the test values")

    if populated_late:
        # We know it was absent on the first read and present on the second —
        # not the exact moment it landed. Say what was observed.
        rep.add("Population timing", WARN,
                f"{', '.join(sorted(populated_late))} was empty on load and filled by "
                f"the {LATE_PASS_DELAY_S:g}s re-read — a visitor who submits fast loses it")
    elif populated_now:
        rep.add("Population timing", PASS, "values present immediately after load")

    # Storage is a different diagnosis, not a pass.
    if rep.storage_hits:
        status = WARN if empty or not second_map else INFO
        rep.add("Stored for later", status,
                "test values also found in " + ", ".join(rep.storage_hits[:6]) +
                (" — the page may inject them at submit time, which this read-only "
                 "check cannot confirm" if status == WARN else ""))
    elif empty:
        rep.add("Stored for later", INFO,
                "no test values in storage or cookies either — nothing is holding them")

    t = rep.tracking
    ids = []
    if t.get("gtm"):
        ids.append("GTM " + ", ".join(t["gtm"]))
    if t.get("ga4"):
        ids.append("GA4 " + ", ".join(t["ga4"]))
    if t.get("meta_pixel"):
        ids.append("Meta pixel " + ", ".join(t["meta_pixel"]))
    rep.add("Tracking present", PASS if ids else WARN,
            "; ".join(ids) if ids else "no GTM container, GA4 measurement ID or Meta pixel found")


# ── Reporting ───────────────────────────────────────────────────────────────
GLYPH = {PASS: "PASS", FAIL: "FAIL", WARN: "WARN", INFO: "····"}

OUTCOME_LINE = {
    "load_failed": "PAGE DID NOT LOAD",
    "timeout": "TIMED OUT",
    "no_form": "NO FORM FOUND",
}


def print_report(rep: UrlReport) -> None:
    print()
    print("─" * 78)
    print(rep.url)
    if rep.outcome != "ok":
        print(f"  {OUTCOME_LINE.get(rep.outcome, rep.outcome.upper())}"
              + (f" — {rep.error}" if rep.error else ""))
        if rep.outcome != "no_form":
            return
    print("─" * 78)
    for c in rep.checks:
        print(f"  {GLYPH[c.status]:<4}  {c.name:<22} {c.detail}")

    fields = [(f.get("name"), f.get("value"), f.get("hidden"), form.get("frame"))
              for form in rep.forms for f in form.get("fields", [])
              if canonical_for(f.get("name", ""))]
    if fields:
        print()
        print("  attribution fields")
        for name, value, hidden, frame in fields:
            shown = value if value else "(empty)"
            where = "iframe" if frame not in ("main",) else "main"
            flag = "hidden" if hidden else "visible"
            print(f"    {name:<28} {shown:<20} {flag:<8} {where}")


def summarise(reports: list[UrlReport]) -> None:
    failed = [r for r in reports if r.failed]
    print()
    print("─" * 78)
    if not failed:
        print(f"  {len(reports)} page(s) checked · no failures")
    else:
        print(f"  {len(reports)} page(s) checked · {len(failed)} with failures:")
        for r in failed:
            reason = OUTCOME_LINE.get(r.outcome) or next(
                (c.detail for c in r.checks if c.status == FAIL), "failed")
            print(f"    {r.url} — {reason}")
    print()


def read_urls(args) -> list[str]:
    urls = list(args.urls)
    if args.file:
        try:
            with open(args.file, encoding="utf-8") as fh:
                for line in fh:
                    line = line.strip()
                    if line and not line.startswith("#"):
                        urls.append(line)
        except OSError as e:
            print(f"could not read {args.file}: {e}", file=sys.stderr)
            raise SystemExit(2)
    return urls


def main() -> int:
    ap = argparse.ArgumentParser(
        description="Check whether a landing page's forms actually capture attribution.")
    ap.add_argument("urls", nargs="*", help="page URL(s) to check")
    ap.add_argument("--file", help="file of URLs, one per line (# comments allowed)")
    ap.add_argument("--json", action="store_true", dest="as_json",
                    help="emit JSON instead of the readable report")
    ap.add_argument("--timeout", type=int, default=DEFAULT_TIMEOUT_MS // 1000,
                    help="page load timeout in seconds (default 30)")
    ap.add_argument("--delay", type=float, default=LATE_PASS_DELAY_S,
                    help="seconds to wait before the second read (default 3)")
    args = ap.parse_args()

    urls = read_urls(args)
    if not urls:
        ap.print_usage(sys.stderr)
        print("give at least one URL, or --file", file=sys.stderr)
        return 2

    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print("playwright is not installed. pip install playwright && playwright install chromium",
              file=sys.stderr)
        return 2

    reports: list[UrlReport] = []
    with sync_playwright() as pw:
        for url in urls:
            try:
                rep = check_url(pw, url, args.timeout * 1000, args.delay)
            except Exception as e:  # noqa: BLE001 — one bad page must not end the batch
                rep = UrlReport(url=url, outcome="load_failed",
                                error=f"{type(e).__name__}: {str(e).splitlines()[0][:200]}")
            reports.append(rep)
            if not args.as_json:
                print_report(rep)

    if args.as_json:
        print(json.dumps({"results": [asdict(r) for r in reports]}, indent=2))
    else:
        summarise(reports)

    return 1 if any(r.failed for r in reports) else 0


if __name__ == "__main__":
    sys.exit(main())
