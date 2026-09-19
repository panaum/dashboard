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
        missing = entry["pages_without"]
        if not missing:
            continue
        have = len(entry["pages_with"])
        if entry["share"] >= MAJORITY:
            out.append(F(
                f"tracking-gap-{entry['vendor']}-{entry['id'] or 'unidentified'}",
                "WARN",
                f"{_name(entry)} is on {have} of {read} pages",
                f"{len(missing)} page{'s' if len(missing) != 1 else ''} carry the "
                f"rest of the site's tracking but not this tag. Visits and "
                f"conversions there are not recorded against it." + _caveat(view),
                [_path(u) for u in missing[:MAX_EVIDENCE]]))
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
