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
