"""
Site-wide tracking consistency — the view one page cannot give you.

`tracking_audit` already reads one page's tags and catches what is wrong *on
that page*: the same pixel loaded twice, a lead form with no tracking, a
thank-you page with no event. What it cannot see is the shape of the site: GA4
on 34 of 37 pages is invisible from any one of the 34, and from any one of the
3. The client finds out when a report is short and nobody can say why.

So this is an aggregation, not a detector. It adds no request, no render and no
new vendor pattern — it reads the same per-page inventories the scan already
produced and reports where they disagree.

Honest by construction:

  * A page we could not read is NOT a page without tracking. Unreadable pages
    are excluded from every denominator and named in the detail, so a render
    that failed can never be reported as a missing tag.
  * Below two readable pages there is no such thing as consistency, and the
    check says so rather than passing. A PASS here means we compared pages and
    they agreed.
  * A tag on a minority of pages is reported as INFO, not WARN. A Meta pixel on
    three landing pages is a deliberate setup, and a tool that calls it a fault
    teaches the client to ignore it.

Findings use the F() shape (id/status/title/detail/evidence), because these are
statements about the site rather than about a URL, and that is the shape the
cards draw. Nothing here is ever FAIL: a tracking gap is a marketing-integrity
problem, not a broken site.
"""
import os
from urllib.parse import urlsplit

_TRUTHY = frozenset({"1", "true", "yes", "on"})
_FALSY = frozenset({"0", "false", "no", "off"})
FLAG = "TRACKING_CONSISTENCY"

# The inventory keys extract_tracking() returns, with the name a client uses.
VENDORS = (
    ("gtm", "Google Tag Manager"),
    ("ga4", "GA4"),
    ("ua", "Universal Analytics"),
    ("meta_pixel", "Meta Pixel"),
    ("linkedin", "LinkedIn Insight"),
    ("tiktok", "TikTok Pixel"),
)

# Below this share of pages, a tag looks deliberate rather than missing.
MAJORITY = 0.5

# A finding names pages, it does not print a sitemap.
MAX_EVIDENCE = 12


def enabled() -> bool:
    """On unless switched off. Each check owns its own flag."""
    return os.getenv(FLAG, "").strip().lower() not in _FALSY


def _path(page_url: str) -> str:
    try:
        p = urlsplit(page_url)
        return (p.path or "/") + (f"?{p.query}" if p.query else "")
    except Exception:
        return page_url


def _ids(inventory: dict, key: str) -> list:
    """Ids for one vendor on one page, with the unreadable-id case normalised.

    extract_tracking reports "(present, id not readable)" when it can see the
    vendor's script but not which account it points at. That is presence
    without identity: it still counts for coverage, and it must not be compared
    as though it were an account id.
    """
    out = []
    for raw in (inventory.get(key) or []):
        ident = str(raw).strip()
        out.append(None if ident.startswith("(") else ident)
    return out


def site_tracking_view(pages: dict) -> dict:
    """Per-vendor coverage across a crawl.

    `pages` maps page URL to that page's extract_tracking() dict, or to None
    for a page the scan could not read. Returns the counts the findings are
    built from, so a consumer can draw its own table.
    """
    readable = {u: t for u, t in (pages or {}).items() if isinstance(t, dict)}
    unreadable = sorted(u for u, t in (pages or {}).items() if not isinstance(t, dict))

    tags: dict = {}
    for page_url, inventory in readable.items():
        for key, label in VENDORS:
            for ident in _ids(inventory, key):
                tags.setdefault((key, label, ident), set()).add(page_url)

    coverage = []
    for (key, label, ident), present in tags.items():
        coverage.append({
            "vendor": key,
            "vendor_label": label,
            "id": ident,
            "pages_with": sorted(present),
            "pages_without": sorted(set(readable) - present),
            "missing_count": len(readable) - len(present),
            # Which list the finding may name. The stored path can prove a tag
            # is PRESENT on a page but cannot enumerate the pages it is absent
            # from, because nothing records which pages a scan read.
            "evidence_kind": "missing",
            "share": len(present) / len(readable) if readable else 0.0,
        })
    coverage.sort(key=lambda c: (-len(c["pages_with"]), c["vendor_label"], c["id"] or ""))

    return {
        "pages_read": len(readable),
        "pages_unreadable": unreadable,
        "coverage": coverage,
        "established": len(readable) >= 2,
    }


def _name(entry: dict) -> str:
    return (f"{entry['vendor_label']} {entry['id']}" if entry["id"]
            else f"{entry['vendor_label']} (account id not readable)")


def _caveat(view: dict) -> str:
    n = len(view["pages_unreadable"])
    if not n:
        return ""
    return (f" {n} page{'s' if n != 1 else ''} could not be read and "
            f"{'are' if n != 1 else 'is'} not counted either way.")


def consistency_findings(view: dict) -> list:
    """F()-shaped findings. Never FAIL; never a PASS we did not establish."""
    F = lambda fid, status, title, detail="", evidence=None: {
        "id": fid, "status": status, "title": title,
        "detail": detail, "evidence": evidence or []}

    read = view["pages_read"]
    if not view["established"]:
        return [F("tracking-consistency", "SKIP",
                  "Tracking consistency not established",
                  f"Consistency is a comparison between pages, and this scan read "
                  f"{read} page{'s' if read != 1 else ''}. Scan more of the site to "
                  f"see whether its tags agree.{_caveat(view)}")]

    out = []
    if not view["coverage"]:
        return [F("tracking-consistency", "WARN",
                  f"No analytics or advertising tag on any of {read} pages",
                  "Nothing on these pages records a visit or a conversion, so "
                  "anything the site produces is invisible in reporting."
                  + _caveat(view))]

    # Gaps: on most pages, missing from some. The common real fault.
    for entry in view["coverage"]:
        missing = entry.get("missing_count", len(entry["pages_without"]))
        if not missing:
            continue
        have = len(entry["pages_with"])
        names = (entry["pages_without"] if entry.get("evidence_kind") == "missing"
                 else entry["pages_with"])
        names_are_missing = entry.get("evidence_kind") == "missing"
        if entry["share"] >= MAJORITY:
            out.append(F(
                f"tracking-gap-{entry['vendor']}-{entry['id'] or 'unidentified'}",
                "WARN",
                f"{_name(entry)} is on {have} of {read} pages",
                f"{missing} page{'s' if missing != 1 else ''} carry the "
                f"rest of the site's tracking but not this tag. Visits and "
                f"conversions there are not recorded against it."
                + ("" if names_are_missing else
                   " The pages listed are the ones that DO carry it; which pages"
                   " do not is beyond what the stored scan records.")
                + _caveat(view),
                [_path(u) for u in names[:MAX_EVIDENCE]]))
        else:
            out.append(F(
                f"tracking-partial-{entry['vendor']}-{entry['id'] or 'unidentified'}",
                "INFO",
                f"{_name(entry)} is on {have} of {read} pages",
                "A minority of pages, which is usually deliberate — a pixel placed "
                "on campaign landing pages only. Worth confirming that is the "
                "intent." + _caveat(view),
                [_path(u) for u in entry["pages_with"][:MAX_EVIDENCE]]))

    # Two accounts of the same kind across one site: usually a migration that
    # was never finished, and it splits the reporting in two.
    for key, label in VENDORS:
        idents = sorted({e["id"] for e in view["coverage"]
                         if e["vendor"] == key and e["id"]})
        if len(idents) > 1:
            out.append(F(
                f"tracking-split-{key}", "WARN",
                f"Two {label} accounts across the site",
                f"Different pages report to different {label} accounts, so no "
                "single account sees the whole site. Usually a migration that "
                "was not finished." + _caveat(view),
                idents[:MAX_EVIDENCE]))

    if not out:
        names = ", ".join(_name(e) for e in view["coverage"][:MAX_EVIDENCE])
        out.append(F("tracking-consistency", "PASS",
                     f"Tracking is consistent across {read} pages",
                     f"Every tag we found is on every page we read: {names}."
                     + _caveat(view)))
    return out


def tracking_consistency(pages: dict) -> dict:
    """The whole check: coverage table plus findings. Empty when switched off."""
    if not enabled():
        return {"enabled": False, "pages_read": 0, "coverage": [], "findings": []}
    view = site_tracking_view(pages)
    return {"enabled": True, **view, "findings": consistency_findings(view)}


# ─── The stored view: the same statements, from data already on disk ────────
#
# The scan-time view above needs a live crawl. The Overview needs to answer
# between scans, so it rebuilds the same inventories from `page_integrations`
# — which already holds host, detected id and category per page per scan,
# 63,000 rows of it. No migration, no second detector, no extra request.

_VENDOR_BY_PREFIX = (("GTM-", "gtm"), ("G-", "ga4"), ("UA-", "ua"))
_VENDOR_BY_HOST = (
    ("connect.facebook", "meta_pixel"), ("facebook.net", "meta_pixel"),
    ("facebook.com", "meta_pixel"),
    ("licdn.com", "linkedin"), ("ads.linkedin.com", "linkedin"),
    ("tiktok.com", "tiktok"),
    ("googletagmanager.com", "gtm"),
    ("google-analytics.com", "ga4"), ("analytics.google.com", "ga4"),
)

_UNREADABLE = "(present, id not readable)"

# The Overview's vocabulary, not the report's.
_ESCALATION = {"PASS": "ok", "INFO": "notice", "WARN": "warn", "SKIP": "unknown"}
_WORST = ("unknown", "ok", "notice", "warn", "critical")


def vendor_of(host: str, detected_id: str):
    """Which vendor an integration row belongs to, or None for anything else.

    A readable id decides it — only Google mints `GTM-`, `G-` and `UA-`. Where
    there is no id the host does, which is how a Meta pixel whose id the page
    does not expose still counts as present.
    """
    ident = (detected_id or "").strip().upper()
    for prefix, vendor in _VENDOR_BY_PREFIX:
        if ident.startswith(prefix):
            return vendor
    low = (host or "").strip().lower()
    for token, vendor in _VENDOR_BY_HOST:
        if token in low:
            return vendor
    return None


def pages_from_integrations(pages, rows) -> dict:
    """Per-page inventories rebuilt from stored integration rows.

    `pages` is every page the scan read. The rows alone cannot supply it: a
    page carrying no third-party tag has no row at all, and such a page must
    count as a page WITHOUT tracking rather than disappear from the
    denominator — which would turn "GA4 on 2 of 10" into "GA4 on 2 of 2".
    """
    inventories = {p: {k: [] for k, _ in VENDORS} for p in pages}
    for page, vendor, ident in _identified(rows):
        if page not in inventories:
            continue
        label = ident or _UNREADABLE
        if label not in inventories[page][vendor]:
            inventories[page][vendor].append(label)
    return inventories


def consistency_card(result) -> dict:
    """The tenth Overview card, in the shape the other nine use.

    Never green by default: with nothing to compare it reads "unavailable" and
    says why, the same way the guard cards do before their first pass.
    """
    base = {"key": "tracking", "label": "Tracking", "days": None}
    if not result or not result.get("enabled"):
        return {**base, "escalation": "unknown", "fact": "unavailable",
                "detail": "The tracking consistency check is switched off.",
                "checks": []}

    findings = result.get("findings") or []
    if not findings:
        return {**base, "escalation": "unknown", "fact": "unavailable",
                "detail": "No scan has read enough pages to compare.", "checks": []}

    checks = [{"key": f["id"], "status": _ESCALATION.get(f["status"], "unknown"),
               "text": f["title"]} for f in findings]
    worst = max((c["status"] for c in checks), key=lambda s: _WORST.index(s)
                if s in _WORST else 0)
    read = result.get("pages_read") or 0
    gaps = [c for c in checks if c["status"] in ("warn", "notice")]

    if worst == "unknown":
        fact = "unavailable"
    elif not gaps:
        fact = "Consistent"
    else:
        fact = f"{len(gaps)} to look at"

    return {**base, "escalation": worst, "fact": fact,
            "detail": findings[0]["title"] + (f" · {read} pages compared" if read else ""),
            "checks": checks}


def _identified(rows):
    """(page, vendor, id) per integration, with the same tag counted once.

    One container produces several rows: the inline snippet carries the id, the
    script resource on the vendor's host does not. Left alone that becomes two
    entries for one container — "Google Tag Manager GTM-ABC" beside "Google Tag
    Manager (account id not readable)" — and the second would be reported as a
    coverage gap that does not exist. Where a page names an id for a vendor,
    the unidentified rows for that vendor on that page are the same thing.
    """
    seen: dict = {}
    for row in rows or []:
        page = row.get("page_url")
        vendor = vendor_of(row.get("host"), row.get("detected_id"))
        if not page or not vendor:
            continue
        ident = (row.get("detected_id") or "").strip() or None
        seen.setdefault((page, vendor), set()).add(ident)
    for (page, vendor), idents in seen.items():
        named = {i for i in idents if i}
        for ident in (sorted(named) if named else [None]):
            yield page, vendor, ident


def stored_view(pages_scanned, rows) -> dict:
    """Coverage from stored rows, where the page LIST is not available.

    `page_integrations` holds a row per third-party tag per page, so it proves
    which pages carry a tag. It cannot supply the denominator: a page with no
    tag at all has no row, and nothing else stored records which pages a scan
    read. `scans.pages_scanned` is that number — and until
    migrations/027 is applied the column does not exist, the write is dropped,
    and this returns "not established" rather than a coverage figure computed
    over the wrong denominator. "GA4 on 2 of 10 pages" would otherwise read as
    "GA4 on 2 of 2", which is a clean result we did not establish.
    """
    read = pages_scanned if isinstance(pages_scanned, int) and pages_scanned > 0 else 0

    tags: dict = {}
    for page, vendor, ident in _identified(rows):
        tags.setdefault((vendor, dict(VENDORS)[vendor], ident), set()).add(page)

    coverage = []
    for (vendor, label, ident), present in tags.items():
        # A page can appear in the rows without having been counted, so never
        # let a tag look present on more pages than the scan says it read.
        have = min(len(present), read) if read else len(present)
        coverage.append({
            "vendor": vendor, "vendor_label": label, "id": ident,
            "pages_with": sorted(present), "pages_without": [],
            "missing_count": max(read - have, 0),
            "evidence_kind": "present",
            "share": (have / read) if read else 0.0,
        })
    coverage.sort(key=lambda c: (-len(c["pages_with"]), c["vendor_label"], c["id"] or ""))

    return {"pages_read": read, "pages_unreadable": [], "coverage": coverage,
            "established": read >= 2}


def stored_consistency(pages_scanned, rows) -> dict:
    """The whole stored-data path: coverage, findings, card."""
    if not enabled():
        return {"enabled": False, "pages_read": 0, "coverage": [], "findings": [],
                "card": consistency_card(None)}
    view = stored_view(pages_scanned, rows)
    result = {"enabled": True, **view, "findings": consistency_findings(view)}
    result["card"] = consistency_card(result)
    return result
