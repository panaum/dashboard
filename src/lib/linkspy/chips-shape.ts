// CLIENT PRESENCE CHIPS — pure shaping. No I/O, no React, no secrets.
//
// Four honest signals per client: SSL, sentinel, open incidents, fragility.
// Each aggregates across the client's sites ON ITS OWN AXIS. The only reduction
// anywhere in this file is worst-of over a severity ladder — there is no
// composite score, and adding one would need an ADR (see
// docs/design-notes/presence-client-chips.md).

export type ChipState = "critical" | "warn" | "notice" | "settling" | "unknown" | "ok";

export type SiteChip = {
  key: string;
  state: ChipState;
  label: string;
  text: string;
  detail?: string | null;
};

export type SitePresence = {
  site_path: string | null;
  chips: SiteChip[];
  worst: ChipState;
};

export type SitesPayload = {
  as_of: string;
  chip_keys: string[];
  sites: Record<string, SitePresence>;
  truncated?: boolean;
  dropped?: number;
};

// Same ladder as the producer. `settling` sits below `notice` and above `ok`:
// it must never be why a client reads green, nor why one reads red.
export const STATE_ORDER: ChipState[] = ["critical", "warn", "notice", "settling", "unknown", "ok"];
const RANK = new Map(STATE_ORDER.map((s, i) => [s, i]));

export function worstState(states: (ChipState | undefined)[]): ChipState {
  const known = states.filter((s): s is ChipState => !!s && RANK.has(s));
  if (!known.length) return "unknown";
  return known.reduce((a, b) => (RANK.get(a)! <= RANK.get(b)! ? a : b));
}

// One glyph per worst state. Deliberately not a "health" emoji — each maps to a
// state the reader can look up in the chips beside it.
const EMOJI: Record<ChipState, string> = {
  critical: "🔴",
  warn: "🟠",
  notice: "🟡",
  settling: "⚪",
  unknown: "⚪",
  ok: "🟢",
};

export function stateEmoji(state: ChipState): string {
  return EMOJI[state] ?? "⚪";
}

export type AggregatedChip = {
  key: string;
  label: string;
  state: ChipState;
  text: string;
  detail: string | null;
  /** Sites at the worst state, out of how many the client has. */
  affected: number;
  total: number;
  /** Set only when exactly one site is implicated — then a deep link is honest. */
  sitePath: string | null;
};

export type ClientPresence = {
  clientId: string;
  clientName: string;
  worst: ChipState;
  chips: AggregatedChip[];
  siteCount: number;
  stale: boolean;
  /** Counts per state across the client's sites — no names, no ids. */
  sitesByLabel?: Record<string, number>;
};

// Operator-facing names for the severity ladder, best-first. Mirrors LinkSpy's
// RANKING_BEST_FIRST; both sides pin this order by test so it cannot drift.
export const RANKING_BEST_FIRST = ["stable", "fresh", "drifting", "fragile", "brittle"] as const;

const DISPLAY: Record<ChipState, string> = {
  ok: "stable",
  settling: "fresh",
  notice: "drifting",
  warn: "fragile",
  critical: "brittle",
  unknown: "unknown",
};

/** "could not tell" is not a point on a durability scale, so it stays 'unknown'. */
export function stateLabel(state: ChipState): string {
  return DISPLAY[state] ?? "unknown";
}

/**
 * Aggregate ONE chip across a client's sites.
 *
 * The worst state always wins — a red on one site of thirty is still a red.
 * Text carries the count whenever the sites disagree, so "ok" never quietly
 * stands in for "ok on the two sites we could see".
 */
export function aggregateChip(
  key: string,
  sites: { id: string; presence: SitePresence }[],
): AggregatedChip | null {
  const found = sites
    .map((s) => ({ id: s.id, path: s.presence.site_path, chip: s.presence.chips.find((c) => c.key === key) }))
    .filter((x): x is { id: string; path: string | null; chip: SiteChip } => !!x.chip);

  if (!found.length) return null;

  const state = worstState(found.map((f) => f.chip.state));
  const atWorst = found.filter((f) => f.chip.state === state);
  const label = found[0].chip.label;
  const total = found.length;

  let text: string;
  if (total === 1) {
    text = found[0].chip.text; // single site: state its own fact, no counting
  } else if (state === "ok") {
    text = `ok on ${total} sites`;
  } else {
    text = `⚠ on ${atWorst.length} of ${total} sites`;
  }

  return {
    key,
    label,
    state,
    text,
    // One implicated site → carry its detail. Several → the detail would be
    // ambiguous, so say nothing rather than something misleading.
    detail: atWorst.length === 1 ? (atWorst[0].chip.detail ?? null) : null,
    affected: atWorst.length,
    total,
    sitePath: atWorst.length === 1 ? atWorst[0].path : null,
  };
}

/**
 * The full presence line for one client. Returns null when the client has no
 * linked site at all — unmapped clients render nothing, byte-identical to today.
 */
export function clientPresence(input: {
  clientId: string;
  clientName: string;
  siteIds: string[];
  payload: SitesPayload | null;
  chipKeys?: string[];
  stale?: boolean;
}): ClientPresence | null {
  if (!input.siteIds.length || !input.payload) return null;

  const sites = input.siteIds
    .map((id) => ({ id, presence: input.payload!.sites?.[id] }))
    .filter((s): s is { id: string; presence: SitePresence } => !!s.presence && Array.isArray(s.presence.chips));

  if (!sites.length) return null;

  const keys = input.chipKeys ?? input.payload.chip_keys ?? [];
  const chips = keys
    .map((k) => aggregateChip(k, sites))
    .filter((c): c is AggregatedChip => c !== null);

  if (!chips.length) return null;

  return {
    clientId: input.clientId,
    clientName: input.clientName,
    // Worst-of over the AGGREGATED chips, so it can never disagree with what
    // the line actually shows.
    worst: worstState(chips.map((c) => c.state)),
    chips,
    siteCount: sites.length,
    stale: Boolean(input.stale),
  };
}

/** The flag. Only the exact string "1" counts. */
export function presenceEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.PRESENCE === "1";
}
