import type { LinkSpyStatusPayload, LinkSpyCheck } from "@/lib/linkspy/catalog-map";

// LIVING CERTIFICATE — Section 1, the live health strip.
//
// Pure: no I/O, no React, no secrets. Turns LinkSpy's raw status into five chip
// states and NOTHING ELSE — no detail strings, no counts, no ids, no site
// reference. F10: the payload is internal; only derived states cross to a client.
//
// ═══ WHY detail_plain IS DROPPED ═══
// LinkSpy's per-check `detail_plain` is a human sentence ("1 broken link on this
// page.", "SSL valid · 52 days remaining."). It reads well, which makes it
// tempting. It is not passed through: it is free text from another system, its
// contents are not contractually bounded, and a page-scoped token must not carry
// whatever a future check decides to write there. Each chip's wording is derived
// HERE, from the state, where we control it.
//
// ═══ THE FIVE STATES, AND THE ONE THAT DOES NOT EXIST ═══
// LinkSpy supplies three verdicts: holding | failing | couldnt_verify.
// Four honest states derive from them:
//
//   healthy    every check for this chip is holding
//   attention  something is failing, but a visitor can still use the site
//   critical   something is failing that a visitor is hurt by RIGHT NOW
//   unknown    no check, or LinkSpy could not verify
//
// A fifth, `settling`, was specified and is NOT implemented. There is no signal
// for it. The one candidate — `uptime` arriving with `last_checked: null` — is a
// healthy check that simply carries no per-check timestamp (its detail reads
// "Reachable · 99.4% uptime"), so treating it as "settling" would label a working
// site with a status no measurement supports. Adding it needs a real input, e.g.
// a monitoring-start timestamp from LinkSpy. Until then the state is absent
// rather than guessed.

export type ChipState = "healthy" | "attention" | "critical" | "unknown";

export type ChipKey = "ssl" | "uptime" | "forms" | "tracking" | "links";

export type Chip = {
  key: ChipKey;
  label: string;
  state: ChipState;
  /** Our wording, derived from the state. Never LinkSpy's text. */
  note: string;
};

export type LiveHealth = {
  chips: Chip[];
  /** When LinkSpy last checked. Null when unknown. */
  as_of: string | null;
  /** True when served from last-known-good because LinkSpy was unreachable. */
  stale: boolean;
};

/**
 * Which catalogue keys feed each chip. Several keys may feed one chip; the worst
 * verdict wins, exactly as catalog-map.ts already reduces item-level checks.
 */
const CHIP_KEYS: Record<ChipKey, string[]> = {
  ssl: ["ssl_valid", "ssl_expiry"],
  uptime: ["uptime"],
  forms: ["forms_submit"],
  tracking: ["ga4_installed", "pixel_present"],
  links: ["broken_links"],
};

const CHIP_LABEL: Record<ChipKey, string> = {
  ssl: "SSL",
  uptime: "Uptime",
  forms: "Forms",
  tracking: "Tracking",
  links: "Links",
};

/**
 * Chips where a failure means a visitor is harmed right now — an insecure
 * connection or an unreachable site. Everything else is degradation: the page
 * still works, something on it does not.
 *
 * This is a PRESENTATION policy, not new measurement. LinkSpy says "failing";
 * this decides how loudly a client should hear it.
 */
const CRITICAL_CHIPS: ReadonlySet<ChipKey> = new Set<ChipKey>(["ssl", "uptime"]);

const NOTE: Record<ChipState, Record<ChipKey, string>> = {
  healthy: {
    ssl: "Valid", uptime: "Reachable", forms: "Submitting",
    tracking: "Active", links: "All working",
  },
  attention: {
    ssl: "Needs attention", uptime: "Unstable", forms: "Not submitting",
    tracking: "Not detected", links: "Broken link found",
  },
  critical: {
    ssl: "Not valid", uptime: "Unreachable", forms: "Not submitting",
    tracking: "Not detected", links: "Broken link found",
  },
  unknown: {
    ssl: "Not checked", uptime: "Not checked", forms: "Not checked",
    tracking: "Not checked", links: "Not checked",
  },
};

const SEVERITY = { failing: 2, couldnt_verify: 1, holding: 0 } as const;

function stateFor(key: ChipKey, checks: LinkSpyCheck[]): ChipState {
  // Absence is never success. A chip with no check is unknown, not healthy —
  // the same rule Sections 3 and 4 apply to null.
  if (checks.length === 0) return "unknown";

  const worst = [...checks].sort(
    (a, b) => (SEVERITY[b.verdict] ?? 0) - (SEVERITY[a.verdict] ?? 0),
  )[0];

  if (worst.verdict === "failing") {
    // An open incident escalates anything: LinkSpy raising one is a real signal
    // that this is not routine degradation.
    const hasIncident = checks.some((c) => Boolean(c.incident_ref));
    return CRITICAL_CHIPS.has(key) || hasIncident ? "critical" : "attention";
  }
  if (worst.verdict === "couldnt_verify") return "unknown";
  return "healthy";
}

/**
 * Build the strip, or null when there is nothing to show.
 *
 * Null when: no payload, or the page is not mapped on LinkSpy. An unmapped page
 * is not an unhealthy one — rendering five grey chips would imply we looked and
 * found nothing, when in fact we never looked.
 */
export function buildLiveHealth(
  payload: LinkSpyStatusPayload | null | undefined,
  opts: { stale?: boolean; asOf?: string | null } = {},
): LiveHealth | null {
  if (!payload || !payload.mapped) return null;

  const all = Array.isArray(payload.checks) ? payload.checks : [];
  const byKey = new Map<string, LinkSpyCheck[]>();
  for (const c of all) {
    if (!c || typeof c.key !== "string") continue;
    const list = byKey.get(c.key) ?? [];
    list.push(c);
    byKey.set(c.key, list);
  }

  const chips: Chip[] = (Object.keys(CHIP_KEYS) as ChipKey[]).map((key) => {
    const checks = CHIP_KEYS[key].flatMap((k) => byKey.get(k) ?? []);
    const state = stateFor(key, checks);
    return { key, label: CHIP_LABEL[key], state, note: NOTE[state][key] };
  });

  return {
    chips,
    as_of: opts.asOf ?? payload.as_of ?? null,
    stale: Boolean(opts.stale),
  };
}

/**
 * The single word Section 4's header uses, derived from the same chips so the
 * header and the strip can never disagree.
 *
 * Null when there is no strip — the header then omits the clause entirely
 * rather than claiming "unknown", which would read as a fault.
 */
export function siteHealthFrom(
  health: LiveHealth | null,
): "healthy" | "attention" | "unknown" | null {
  if (!health) return null;
  const states = health.chips.map((c) => c.state);
  if (states.includes("critical") || states.includes("attention")) return "attention";
  if (states.includes("healthy")) return "healthy";
  return "unknown";
}
