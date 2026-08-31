// SITES VIEW — pure shaping for /dashboard/sites. No I/O, no React, no secrets.
//
// The list shows exactly what the registry bridge exposes (sites a LinkSpy
// operator has annotated with a client), decorated with the same per-site
// chips the client views use and the count of Dashboard pages linked to each
// site. Worst-first ordering: a red site must never hide below the fold.

import {
  type ChipState,
  type SiteChip,
  type SitesPayload,
  STATE_ORDER,
} from "./chips-shape";
import { hostOf } from "./link-match";

export type RegistrySiteRow = {
  id: string;
  url: string | null;
  name?: string | null;
  clientName: string;
};

export type SiteListItem = {
  id: string;
  url: string | null;
  host: string | null;
  clientName: string;
  linkedPages: number;
  worst: ChipState;
  chips: SiteChip[];
  sitePath: string | null;
};

const RANK = new Map(STATE_ORDER.map((s, i) => [s, i]));

export function buildSitesList(
  sites: RegistrySiteRow[],
  chips: SitesPayload | null,
  linked: ReadonlyMap<string, number>,
): SiteListItem[] {
  const items = sites.map((s) => {
    const p = chips?.sites?.[s.id];
    return {
      id: s.id,
      url: s.url,
      host: hostOf(s.url),
      clientName: s.clientName,
      linkedPages: linked.get(s.id) ?? 0,
      worst: p?.worst ?? ("unknown" as ChipState),
      chips: p?.chips ?? [],
      sitePath: p?.site_path ?? null,
    };
  });
  // Worst state first; ties break on host so the order is stable and legible.
  return items.sort(
    (a, b) =>
      (RANK.get(a.worst) ?? RANK.size) - (RANK.get(b.worst) ?? RANK.size) ||
      (a.host ?? "").localeCompare(b.host ?? ""),
  );
}

// Chip state → design-system badge tone. `settling`/`unknown` stay neutral on
// purpose: they must never read as either health or alarm.
export const STATE_TONE: Record<
  ChipState,
  "error" | "warning" | "info" | "neutral" | "success"
> = {
  critical: "error",
  warn: "warning",
  notice: "info",
  settling: "neutral",
  unknown: "neutral",
  ok: "success",
};

export const STATE_LABEL: Record<ChipState, string> = {
  critical: "Critical",
  warn: "Warning",
  notice: "Notice",
  settling: "Settling",
  unknown: "No signal",
  ok: "Healthy",
};

// ── Latest scan (GET /api/qa-bridge/site-scan) ──────────────────────────────

export type ScanTotals = {
  links: number;
  ok: number;
  broken: number;
  unverifiable: number;
  dead_cta: number;
};

export type FlaggedLink = {
  url?: string;
  bucket?: string;
  label?: string;
  status_code?: number | null;
  reason?: string | null;
  resource_type?: string | null;
  category?: string | null;
  source_page?: string | null;
  priority?: string | null;
};

export type ScanPayload = {
  no_scan: boolean;
  scanned_at?: string | null;
  totals?: Partial<ScanTotals> & Record<string, number>;
  flagged?: FlaggedLink[];
};

export type ScanView =
  | { state: "unavailable" }
  | { state: "no_scan" }
  | { state: "clean"; scannedAt: string | null; totals: ScanTotals }
  | { state: "issues"; scannedAt: string | null; totals: ScanTotals; flagged: FlaggedLink[] };

export function buildScanView(payload: ScanPayload | null | undefined): ScanView {
  if (!payload) return { state: "unavailable" };
  if (payload.no_scan) return { state: "no_scan" };
  const t = payload.totals ?? {};
  const totals: ScanTotals = {
    links: t.links ?? 0,
    ok: t.ok ?? 0,
    broken: t.broken ?? 0,
    unverifiable: t.unverifiable ?? 0,
    dead_cta: t.dead_cta ?? 0,
  };
  const flagged = payload.flagged ?? [];
  if (!flagged.length && totals.broken === 0 && totals.dead_cta === 0) {
    return { state: "clean", scannedAt: payload.scanned_at ?? null, totals };
  }
  return { state: "issues", scannedAt: payload.scanned_at ?? null, totals, flagged };
}

// Flagged bucket → badge tone. Unknown buckets read neutral, never green.
export function bucketTone(bucket: string | undefined): "error" | "warning" | "neutral" {
  if (bucket === "broken") return "error";
  if (bucket === "dead_cta") return "warning";
  return "neutral";
}

// ── Downtime incidents (GET /api/qa-bridge/site-incidents) ──────────────────

export type IncidentRow = { down_at?: string | null; restored_at?: string | null };
export type IncidentsPayload = { incidents?: IncidentRow[]; open?: number };

export type IncidentItem = {
  downAt: string;
  restoredAt: string | null;
  /** "2h 14m" for a closed window; null while ongoing (no clock reads here —
   *  elapsed time for an open incident is a live fact this pure layer can't
   *  know, so the UI renders the state, not a number). */
  duration: string | null;
  ongoing: boolean;
};

export type IncidentsView =
  | { state: "unavailable" }
  | { state: "none" }
  | { state: "list"; open: number; items: IncidentItem[] };

export function formatWindow(downAt: string, restoredAt: string | null): string | null {
  if (!restoredAt) return null;
  const ms = Date.parse(restoredAt) - Date.parse(downAt);
  if (!Number.isFinite(ms) || ms < 0) return null;
  const mins = Math.round(ms / 60000);
  if (mins < 1) return "under a minute";
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h < 24) return m ? `${h}h ${m}m` : `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}

export function buildIncidentsView(payload: IncidentsPayload | null | undefined): IncidentsView {
  if (!payload) return { state: "unavailable" };
  const rows = (payload.incidents ?? []).filter((r): r is IncidentRow & { down_at: string } =>
    typeof r?.down_at === "string",
  );
  if (!rows.length) return { state: "none" };
  return {
    state: "list",
    open: payload.open ?? rows.filter((r) => !r.restored_at).length,
    items: rows.map((r) => ({
      downAt: r.down_at,
      restoredAt: r.restored_at ?? null,
      duration: formatWindow(r.down_at, r.restored_at ?? null),
      ongoing: !r.restored_at,
    })),
  };
}

// ── Sites health rollup (the Overview strip) ────────────────────────────────

export type SitesHealth = {
  total: number;
  attention: number; // critical + warn
  healthy: number;   // ok
  quiet: number;     // everything else: notice / settling / unknown
};

export function summarizeSitesHealth(items: Pick<SiteListItem, "worst">[]): SitesHealth {
  const out: SitesHealth = { total: items.length, attention: 0, healthy: 0, quiet: 0 };
  for (const i of items) {
    if (i.worst === "critical" || i.worst === "warn") out.attention++;
    else if (i.worst === "ok") out.healthy++;
    else out.quiet++;
  }
  return out;
}

// ── Site vitals (GET /api/qa-bridge/site-vitals) ────────────────────────────
// The wire shape is LinkSpy's own summarize_sentinel output, passed through.

export type VitalEscalation = "critical" | "warn" | "notice" | "unknown" | "ok";

export type VitalCard = {
  key: string;
  label: string;
  escalation: VitalEscalation;
  fact: string;
  detail?: string | null;
};

export type VitalsPayload = {
  cards?: VitalCard[];
  worst?: VitalEscalation;
  all_clear?: boolean;
  last_checked?: string | null;
};

export type VitalsView =
  | { state: "unavailable" }
  | { state: "cards"; cards: VitalCard[]; allClear: boolean; lastChecked: string | null };

export function buildVitalsView(payload: VitalsPayload | null | undefined): VitalsView {
  if (!payload || !Array.isArray(payload.cards) || !payload.cards.length) {
    return { state: "unavailable" };
  }
  return {
    state: "cards",
    cards: payload.cards,
    allClear: payload.all_clear === true,
    lastChecked: payload.last_checked ?? null,
  };
}

export const ESCALATION_TONE: Record<VitalEscalation, "error" | "warning" | "info" | "neutral" | "success"> = {
  critical: "error",
  warn: "warning",
  notice: "info",
  unknown: "neutral",
  ok: "success",
};

// ── Scan history (GET /api/qa-bridge/site-history) ──────────────────────────

export type HistoryPoint = {
  at?: string | null;
  health_score?: number | null;
  total_links?: number | null;
  findings?: number | null;
  new?: number | null;
  fixed?: number | null;
  recurring?: number | null;
};

export type HistoryPayload = { points?: HistoryPoint[] };

export type HistoryView =
  | { state: "unavailable" }
  | { state: "none" }
  | { state: "series"; points: Required<Pick<HistoryPoint, "at">>[] & HistoryPoint[] };

export function buildHistoryView(payload: HistoryPayload | null | undefined): HistoryView {
  if (!payload) return { state: "unavailable" };
  const points = (payload.points ?? []).filter(
    (p): p is HistoryPoint & { at: string } => typeof p?.at === "string",
  );
  if (!points.length) return { state: "none" };
  return { state: "series", points };
}

/** Health score → tone, matching LinkSpy's own thresholds (green ≥90, amber ≥70). */
export function healthTone(score: number | null | undefined): "success" | "warning" | "error" | "neutral" {
  if (typeof score !== "number") return "neutral";
  if (score >= 90) return "success";
  if (score >= 70) return "warning";
  return "error";
}
