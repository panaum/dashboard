// CLIENT INTELLIGENCE — pure shaping. No I/O, no secrets, no server-only
// imports, so every state is testable without Next's bundler.
//
// The aggregation itself is NOT here: LinkSpy already aggregated across the
// client's sites. This file only adapts the wire shape onto the renderer's,
// because doing the aggregation twice would be two authorities for one rule.
import type { AggregatedChip, ChipState, ClientPresence } from "./chips-shape";
import { worstState } from "./chips-shape";

export type WireChip = {
  key: string;
  label: string;
  state: ChipState;
  text: string;
  detail: string | null;
  affected: number;
  total: number;
  site_path: string | null;
};

// Counts only — no site names, no site ids. Per-site detail is reached by
// clicking through to LinkSpy on a signed handoff (decision 3).
export type SitesSummary = {
  total: number;
  by_state: Record<string, number>;
  by_label: Record<string, number>;
};

export type ClientIntelligencePayload = {
  registry_client_id: string;
  as_of: string;
  chip_keys: string[];
  site_count: number;
  worst: ChipState;
  worst_label?: string;
  chips: WireChip[];
  sites_summary?: SitesSummary;
};

/** The flag. Only the exact string "1" counts — half-on is not a state. */
export function clientIntelligenceEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return env.CLIENT_INTELLIGENCE === "1";
}

/**
 * Adapt LinkSpy's already-aggregated chips onto the shape the shared
 * <ClientPresenceLine/> expects. Returns null whenever there is nothing to
 * show, so the caller renders nothing at all.
 */
export function toClientPresence(
  clientId: string,
  clientName: string,
  payload: ClientIntelligencePayload | null,
  stale = false,
): ClientPresence | null {
  if (!payload || !Array.isArray(payload.chips) || payload.chips.length === 0) return null;

  const chips: AggregatedChip[] = payload.chips.map((c) => ({
    key: c.key,
    label: c.label,
    state: c.state,
    text: c.text,
    detail: c.detail ?? null,
    affected: c.affected,
    total: c.total,
    // A non-relative path is refused outright — it must never be signed into a
    // handoff token.
    sitePath: typeof c.site_path === "string" && c.site_path.startsWith("/") ? c.site_path : null,
  }));

  return {
    clientId,
    clientName,
    // Recomputed from the chips we actually render, so the headline can never
    // disagree with the line — even if the wire claimed something else.
    worst: worstState(chips.map((c) => c.state)),
    chips,
    siteCount: payload.site_count ?? 0,
    stale,
    sitesByLabel: payload.sites_summary?.by_label,
  };
}
