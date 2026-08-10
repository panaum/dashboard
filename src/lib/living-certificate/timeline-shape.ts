// LIVING CERTIFICATE — the client-facing timeline contract.
//
// This is the whitelist boundary. LinkSpy's /api/registry-bridge/timeline is an
// INTERNAL service-key route and returns `payload` raw, because spine events
// carry internal ids. Deciding what a client may see happens HERE, in the app
// that owns the client relationship.
//
// ═══ DENY BY DEFAULT ═══
// An event type not on ALLOWED is dropped entirely — not passed through, not
// rendered with a generic label. This is the load-bearing property: when a new
// event type is added to the spine later (and it will be — §8.1 calls the event
// catalogue a socket), it CANNOT leak to a client's browser by default. Someone
// has to come here and decide.
//
// Pure: no I/O, no React, no secrets, so every case is testable.

/** One event as a client may see it. Note what is absent: no ids of any kind. */
export type ClientTimelineEvent = {
  /** ISO timestamp — the only field taken verbatim from the ledger. */
  at: string;
  /** Stable key for the renderer. Not the raw spine type. */
  kind: "handed_to_qa" | "signed_off";
  title: string;
  detail: string | null;
};

/** The wire shape from LinkSpy. `payload` is raw and must never be spread. */
export type LedgerEvent = {
  id?: string;
  registry_site_id?: string | null;
  registry_deliverable_id?: string | null;
  type?: string;
  payload?: Record<string, unknown> | null;
  occurred_at?: string;
  source?: string | null;
};

type Rule = {
  kind: ClientTimelineEvent["kind"];
  title: string;
  /** Builds the one client-safe sentence. Reads named keys only — never spreads. */
  detail: (payload: Record<string, unknown>) => string | null;
};

// Grounded in what the Dashboard actually emits (src/lib/spine-emit.ts) and
// what the spine actually carries (backend/spine_contract.py EVENT_TYPES).
//
// Deliberately excluded, with reasons:
//   heartbeat                    — plumbing; never reaches the timeline anyway
//   checklist.candidate_created  — internal QA process improvement (flywheel)
//   checklist.item_promoted      — same; a client has no stake in our checklist
// Those three are about how we work, not about their site.
const ALLOWED: Record<string, Rule> = {
  "deliverable.ready_for_qa": {
    kind: "handed_to_qa",
    title: "Handed to quality assurance",
    // payload also carries qa_page_ref (an internal Page id) and url. Neither
    // is read here — a client does not need our primary keys.
    detail: () => null,
  },
  "qa.completed": {
    kind: "signed_off",
    title: "Quality assurance signed off",
    detail: (payload) => {
      const s = payload.checklist_summary;
      if (!s || typeof s !== "object") return null;
      const passed = (s as Record<string, unknown>).passed;
      if (typeof passed !== "number" || passed < 0) return null;
      return `${passed} check${passed === 1 ? "" : "s"} passed`;
    },
  },
};

/** The event types a client may ever see. Everything else is dropped. */
export const CLIENT_VISIBLE_TYPES = Object.keys(ALLOWED);

function isValidTimestamp(v: unknown): v is string {
  return typeof v === "string" && !Number.isNaN(new Date(v).getTime());
}

/**
 * Whitelist a ledger page into the client-facing contract.
 *
 * Drops: unknown types, malformed rows, undated rows. Never spreads `payload`,
 * never emits an id. Ordering is preserved (LinkSpy returns newest-first).
 */
export function toClientTimeline(events: LedgerEvent[] | null | undefined): ClientTimelineEvent[] {
  if (!Array.isArray(events)) return [];
  const out: ClientTimelineEvent[] = [];
  for (const e of events) {
    if (!e || typeof e !== "object") continue;
    const rule = typeof e.type === "string" ? ALLOWED[e.type] : undefined;
    if (!rule) continue; // deny by default
    if (!isValidTimestamp(e.occurred_at)) continue;
    const payload = e.payload && typeof e.payload === "object" ? e.payload : {};
    out.push({
      at: e.occurred_at,
      kind: rule.kind,
      title: rule.title,
      detail: rule.detail(payload),
    });
  }
  return out;
}
