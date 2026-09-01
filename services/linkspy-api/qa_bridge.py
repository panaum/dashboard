"""Pure, I/O-free helpers for the QA-bridge status endpoint: service-key header
parsing and a small fixed-window rate limiter with an injectable clock (so it's
deterministically testable). No DB, no scans, no network."""


def parse_service_key(authorization=None, x_api_key=None):
    """Extract the raw service token from either an `Authorization: Bearer …`
    header or an `X-Api-Key` header. Returns the token, or None if absent."""
    if authorization and authorization.lower().startswith("bearer "):
        tok = authorization[7:].strip()
        return tok or None
    if x_api_key and x_api_key.strip():
        return x_api_key.strip()
    return None


class RateLimiter:
    """Fixed-window per-key limiter. `now` is passed in (seconds, monotonic-ish)
    so tests control time. Lenient by design — this blunts abuse on a read-only
    endpoint, it doesn't meter fair use."""

    def __init__(self, max_requests=120, window_s=60.0):
        self.max = max_requests
        self.window = window_s
        self._buckets = {}

    def allow(self, key, now):
        b = self._buckets.get(key)
        if not b or now - b[0] >= self.window:
            self._buckets[key] = [now, 1]
            return True
        if b[1] >= self.max:
            return False
        b[1] += 1
        return True


# ─── Latest-scan snapshot (Deliverables "Sites" view) ────────────────────────
# Pure shaping of a stored `scans` row into the service-key read payload.
# Buckets come from checker.bucket_for_label; anything unrecognized counts as
# its own bucket rather than being silently folded into "ok" — a new bucket
# should surface, not vanish.

SCAN_FLAG_FIELDS = ("url", "bucket", "label", "status_code", "reason",
                    "resource_type", "category", "source_page", "priority")
SCAN_FLAG_LIMIT = 200


# ─── Full scan view (the in-dashboard scanner) ───────────────────────────────
# Every link, whitelisted, plus placement/zone/timing and the breakdown panels
# — enough to reproduce the LinkSpy scanner UI. Heavier than summarize_scan;
# used only by the interactive scanner's final payload.

FULL_LINK_FIELDS = ("url", "anchor_text", "bucket", "label", "status_code",
                    "final_url", "response_ms", "resource_type", "category",
                    "reason", "is_external", "occurrences", "priority")
FULL_LINK_CAP = 1000


def _primary_zone(row):
    zones = row.get("zones")
    if isinstance(zones, list) and zones:
        return zones[0]
    return "other"


def summarize_full_scan(results, breakdowns=None, health_score=None,
                        total_placements=None):
    """All links (whitelisted) + zone + the four breakdown panels. `results`
    is the list of LinkResult dicts; `breakdowns` is _breakdowns() output."""
    rows = [r for r in (results or []) if isinstance(r, dict)]
    links = []
    counts = {"ok": 0, "broken": 0, "unverifiable": 0, "dead_cta": 0}
    for r in rows[:FULL_LINK_CAP]:
        bucket = r.get("bucket") or ("ok" if r.get("label") == "ok" else r.get("label")) or "ok"
        if bucket in ("ok", "redirect"):
            bucket = "ok"
        counts[bucket] = counts.get(bucket, 0) + 1
        item = {k: r.get(k) for k in FULL_LINK_FIELDS if k in r}
        item["bucket"] = bucket
        item["zone"] = _primary_zone(r)
        links.append(item)
    placements = total_placements
    if placements is None:
        placements = sum((r.get("occurrences") or 1) for r in rows)
    return {
        "health_score": health_score,
        "links": links,
        "unique_links": len(rows),
        "placements": placements,
        "totals": {"links": len(rows), **counts},
        "breakdowns": breakdowns or {},
        "truncated": len(rows) > FULL_LINK_CAP,
    }


def summarize_scan(scan):
    """None → no_scan marker; a scans row ({id, results_json, scanned_at}) →
    totals by bucket + the flagged (non-ok) rows, whitelisted and capped."""
    if not scan:
        return {"no_scan": True}
    links = [r for r in (scan.get("results_json") or []) if isinstance(r, dict)]
    counts = {}
    for r in links:
        b = r.get("bucket") or "ok"
        counts[b] = counts.get(b, 0) + 1
    flagged = [{k: r.get(k) for k in SCAN_FLAG_FIELDS if k in r}
               for r in links if (r.get("bucket") or "ok") != "ok"][:SCAN_FLAG_LIMIT]
    totals = {"links": len(links)}
    for k in ("ok", "broken", "unverifiable", "dead_cta"):
        totals[k] = counts.pop(k, 0)
    totals.update(counts)  # unknown buckets surface by name
    return {"no_scan": False, "scanned_at": scan.get("scanned_at"),
            "totals": totals, "flagged": flagged}


# ─── Downtime incidents (Deliverables site detail) ───────────────────────────

INCIDENT_FIELDS = ("down_at", "restored_at")


def summarize_incidents(rows):
    """sentinel_incidents rows → whitelisted windows plus the open count.
    An incident with no restored_at is ongoing; the consumer renders that as a
    state, never computes elapsed time (no clock here, per the same rule the
    Dashboard applies to its own aggregation)."""
    items = [{k: r.get(k) for k in INCIDENT_FIELDS}
             for r in (rows or []) if isinstance(r, dict)]
    return {"incidents": items,
            "open": sum(1 for i in items if not i.get("restored_at"))}


# ─── Scan history (Deliverables site detail trend) ───────────────────────────
# totals_json also carries link_fingerprints / redirect_rules / builder hints —
# internals that must never cross the bridge. Scalars only.

HISTORY_FIELDS = ("health_score", "total_links", "findings", "new", "fixed", "recurring")
HISTORY_LIMIT = 30


def summarize_history(rows):
    """scan_snapshots rows ({created_at, totals_json}) → whitelisted scalar
    points, order preserved (caller reads newest-first), capped."""
    out = []
    for r in (rows or [])[:HISTORY_LIMIT]:
        if not isinstance(r, dict):
            continue
        totals = r.get("totals_json") or {}
        point = {"at": r.get("created_at")}
        for k in HISTORY_FIELDS:
            v = totals.get(k)
            point[k] = v if isinstance(v, (int, float)) else None
        out.append(point)
    return {"points": out}


# ─── Dashboard-run checks (async job snapshots) ──────────────────────────────

CHECK_PUBLIC_FIELDS = ("status", "url", "progress", "summary", "full", "error")


def check_snapshot(entry):
    """Public view of one check-job entry: whitelisted, never internals.
    Unknown id → a typed not_found, so the poller can stop cleanly."""
    if not entry:
        return {"status": "not_found"}
    return {k: entry.get(k) for k in CHECK_PUBLIC_FIELDS if entry.get(k) is not None}


# ─── Third-party integrations (scanner "Integrations" panel) ─────────────────

INTEGRATION_FIELDS = ("host", "resource_url", "category", "type", "detected_id", "health")
INTEGRATION_CAP = 100

# Health values the collector emits. Anything unknown renders neutral, never
# green — an unrecognised state must not read as "verified healthy".
INTEGRATION_HEALTHY = ("healthy", "ok", "up")


def summarize_integrations(rows):
    """Whitelisted third-party integration records + a health rollup."""
    items = []
    down = 0
    unknown = 0
    for r in (rows or [])[:INTEGRATION_CAP]:
        if not isinstance(r, dict):
            continue
        item = {k: r.get(k) for k in INTEGRATION_FIELDS if r.get(k) is not None}
        h = (item.get("health") or "").lower()
        if h in ("down", "broken", "error"):
            down += 1
        elif h not in INTEGRATION_HEALTHY:
            unknown += 1
        items.append(item)
    return {"items": items, "total": len(items), "down": down, "unknown": unknown}
