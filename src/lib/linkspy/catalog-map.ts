// "Still True Today" — pure, dependency-free mapping + policy. No secrets, no
// I/O; safe to import from anywhere (server or client). LinkSpy exposes live
// verdicts; here we map them onto QA checklist items and decide what to serve.
//
// Item matching is by exact QACheckItem.name (the QA app's de-facto key — there
// is no slug column; see src/lib/qa-template.ts). The mapping is deliberately
// CONSERVATIVE: only checks with an honest 1:1 equivalent are surfaced; anything
// else is ignored so a checklist item is never mislabeled.

export type LinkSpyVerdict = "holding" | "failing" | "couldnt_verify";

export type LinkSpyCheck = {
  key: string;
  label?: string;
  source?: string;
  verdict: LinkSpyVerdict;
  detail_plain: string;
  last_checked: string | null;
  incident_ref: string | null;
};

export type LinkSpyStatusPayload = {
  mapped: boolean;
  catalog_version?: number;
  as_of?: string | null;
  summary?: { total: number; holding: number; failing: number; couldnt_verify: number };
  checks?: LinkSpyCheck[];
  site?: { id: string };
  page_url?: string | null;
};

// Item-level: LinkSpy catalog key → the exact QACheckItem.name it annotates.
// Several keys may target the same item (SSL validity + expiry → the SSL row).
export const ITEM_MAP: Record<string, string> = {
  ssl_valid: "SSL Certificate showing up correctly",
  ssl_expiry: "SSL Certificate showing up correctly",
  page_load_time: "GTMetrix Page Load Time",
  forms_submit: "Form Submits Correctly",
  ga4_installed: "Google Analytics Installed",
  pixel_present: "Facebook Pixel Installed",
  broken_links: "All CTA buttons work",
};

// Page-level: no clean checklist item → surfaced near the QA-health ring, not
// against a row.
export const PAGE_LEVEL_KEYS = new Set(["uptime", "domain_expiry"]);

export type LiveStatus = {
  key: string;
  verdict: LinkSpyVerdict;
  detail: string;
  lastChecked: string | null;
  incidentRef: string | null;
};

export type Summary = { total: number; holding: number; failing: number; couldnt_verify: number };

export type Annotations = {
  byItemName: Record<string, LiveStatus>; // one line per mapped checklist item
  pageLevel: LiveStatus[]; //                uptime / domain, each its own line
  summary: Summary; //                       counts only what THIS app surfaces
  watchedItemCount: number; //               distinct checklist items under watch
};

const SEVERITY: Record<LinkSpyVerdict, number> = { failing: 2, couldnt_verify: 1, holding: 0 };

// When >1 check targets one item, the worst verdict wins and supplies the detail.
function reduce(checks: LinkSpyCheck[]): LiveStatus {
  const worst = [...checks].sort((a, b) => SEVERITY[b.verdict] - SEVERITY[a.verdict])[0];
  return {
    key: worst.key, verdict: worst.verdict, detail: worst.detail_plain,
    lastChecked: worst.last_checked, incidentRef: worst.incident_ref,
  };
}

// Pure: raw status payload → per-item + page-level annotations. Returns null when
// there's nothing to show (no payload, or the page isn't mapped on LinkSpy).
export function buildAnnotations(payload: LinkSpyStatusPayload | null | undefined): Annotations | null {
  if (!payload || !payload.mapped || !Array.isArray(payload.checks)) return null;
  const grouped: Record<string, LinkSpyCheck[]> = {};
  const pageLevel: LiveStatus[] = [];
  for (const c of payload.checks) {
    if (!c || typeof c.key !== "string") continue;
    if (PAGE_LEVEL_KEYS.has(c.key)) { pageLevel.push(reduce([c])); continue; }
    const name = ITEM_MAP[c.key];
    if (!name) continue; //                  unmapped key → surfaced nowhere (honest)
    (grouped[name] ||= []).push(c);
  }
  const byItemName: Record<string, LiveStatus> = {};
  for (const [name, checks] of Object.entries(grouped)) byItemName[name] = reduce(checks);

  const surfaced = [...Object.values(byItemName), ...pageLevel];
  const summary: Summary = {
    total: surfaced.length,
    holding: surfaced.filter((s) => s.verdict === "holding").length,
    failing: surfaced.filter((s) => s.verdict === "failing").length,
    couldnt_verify: surfaced.filter((s) => s.verdict === "couldnt_verify").length,
  };
  return { byItemName, pageLevel, summary, watchedItemCount: Object.keys(byItemName).length };
}

// ── cache / last-known-good policy (pure, so the staleness path is testable) ──
export type CachedRow = { payload: LinkSpyStatusPayload; fetchedAt: Date } | null;

export type ServedStatus = {
  payload: LinkSpyStatusPayload;
  asOf: string; //   when LinkSpy last checked (or when we fetched)
  stale: boolean; // served from last-known-good because LinkSpy was unreachable
};

function serve(payload: LinkSpyStatusPayload, when: Date, stale: boolean): ServedStatus | null {
  if (!payload || !payload.mapped) return null; // unmapped → nothing to render
  return { payload, asOf: payload.as_of ?? when.toISOString(), stale };
}

// Fresh cache hit? Returns the served status, or null meaning "cache miss/expired
// → the caller should fetch". A cached-but-unmapped row still counts as a hit
// (returns null-from-serve), so we don't refetch a known-unmapped page every load.
export function serveFromCache(cached: CachedRow, now: number, cacheMs: number): { hit: boolean; status: ServedStatus | null } {
  if (!cached) return { hit: false, status: null };
  if (now - cached.fetchedAt.getTime() >= cacheMs) return { hit: false, status: null };
  return { hit: true, status: serve(cached.payload, cached.fetchedAt, false) };
}

// After a live fetch: prefer fresh; on unreachable (fresh === null) fall back to
// last-known-good marked stale; with neither, nothing to show.
export function serveAfterFetch(cached: CachedRow, fresh: LinkSpyStatusPayload | null, fetchedAt: Date): ServedStatus | null {
  if (fresh) return serve(fresh, fetchedAt, false);
  if (cached) return serve(cached.payload, cached.fetchedAt, true);
  return null;
}
