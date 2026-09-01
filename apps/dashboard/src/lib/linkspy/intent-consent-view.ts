// INTENT MAP + CONSENT — pure shaping (spec §3.2, §3.5). No I/O, no React.

// ── Intent map ───────────────────────────────────────────────────────────────

export type Promise_ = {
  type: string;
  tier?: string | null;
  label: string;
  anchor: string;
  zone?: string | null;
  url: string;
  final_url?: string | null;
  verdict: "honored" | "broken" | "unverified";
  evidence?: string | null;
  severity?: string | null;
  weight?: number | null;
};

export type IntentMapPayload = {
  verdict?: string;
  all_clear?: boolean;
  no_scan?: boolean;
  counts?: {
    conversion_total?: number;
    honored?: number;
    broken?: number;
    unverified?: number;
    functional_total?: number;
  };
  promises?: Promise_[];
};

export type IntentMapView =
  | { state: "unavailable" }
  | { state: "no_scan" }
  | { state: "no_promises"; verdict: string }
  | {
      state: "map";
      verdict: string;
      allClear: boolean;
      counts: Required<NonNullable<IntentMapPayload["counts"]>>;
      promises: Promise_[];
    };

export function buildIntentMapView(p: IntentMapPayload | null | undefined): IntentMapView {
  if (!p) return { state: "unavailable" };
  if (p.no_scan) return { state: "no_scan" };
  const c = p.counts ?? {};
  const counts = {
    conversion_total: c.conversion_total ?? 0,
    honored: c.honored ?? 0,
    broken: c.broken ?? 0,
    unverified: c.unverified ?? 0,
    functional_total: c.functional_total ?? 0,
  };
  if (counts.conversion_total === 0) {
    return { state: "no_promises", verdict: p.verdict ?? "No conversion promises found on this site yet." };
  }
  // broken promises first, then unverified, then honored — worst surfaces up.
  const rank = { broken: 0, unverified: 1, honored: 2 } as const;
  const promises = [...(p.promises ?? [])].sort(
    (a, b) => (rank[a.verdict] ?? 3) - (rank[b.verdict] ?? 3),
  );
  return { state: "map", verdict: p.verdict ?? "", allClear: p.all_clear === true, counts, promises };
}

export function verdictTone(v: Promise_["verdict"]): "error" | "neutral" | "success" {
  if (v === "broken") return "error";
  if (v === "unverified") return "neutral"; // honesty rule: unverified is never red
  return "success";
}

// ── Consent sessions ─────────────────────────────────────────────────────────

export type ConsentRequest = {
  host: string;
  class?: string | null; // advertising | analytics | essential | …
  provenance?: string | null;
  ms_after_load?: number | null;
};

export type ConsentSession = {
  id: string;
  page_url: string;
  regime?: string | null;
  // The backend sends cmp as an object ({} or { name, ... }) — never render it raw.
  cmp?: unknown;
  requests?: ConsentRequest[];
  verdicts?: unknown;
  created_at?: string | null;
};

/** A human label for the CMP field, which the backend sends as an object,
 *  a string, or nothing. Returns null when there's nothing to show — so a
 *  bare `{}` never reaches React as a child (that throws and blanks the page). */
export function cmpLabel(cmp: unknown): string | null {
  if (!cmp) return null;
  if (typeof cmp === "string") return cmp.trim() || null;
  if (typeof cmp === "object") {
    const o = cmp as Record<string, unknown>;
    const name = o.name ?? o.provider ?? o.vendor;
    if (typeof name === "string" && name.trim()) return name.trim();
    return null; // an empty/detail-only object has no display name
  }
  return null;
}

export type ConsentPayload = { scope_statement?: string; sessions?: ConsentSession[] };

export type ConsentView =
  | { state: "unavailable" }
  | { state: "empty"; scopeStatement: string }
  | { state: "sessions"; scopeStatement: string; sessions: ConsentSession[] };

// The spec caps shown third-party requests at 8; the UI must say so when it truncates.
export const CONSENT_REQUEST_CAP = 8;

export function buildConsentView(p: ConsentPayload | null | undefined): ConsentView {
  if (!p) return { state: "unavailable" };
  const scope = p.scope_statement ?? "";
  const sessions = p.sessions ?? [];
  if (!sessions.length) return { state: "empty", scopeStatement: scope };
  return { state: "sessions", scopeStatement: scope, sessions };
}

/** Requests to render (capped) + whether more were hidden. */
export function cappedRequests(session: ConsentSession): {
  shown: ConsentRequest[];
  hidden: number;
} {
  const all = session.requests ?? [];
  return { shown: all.slice(0, CONSENT_REQUEST_CAP), hidden: Math.max(all.length - CONSENT_REQUEST_CAP, 0) };
}

export function requestClassTone(cls: string | null | undefined): "error" | "warning" | "neutral" {
  if (cls === "advertising") return "error";
  if (cls === "analytics") return "warning";
  return "neutral"; // essential / unknown
}
