import { toClientTimeline, type ClientTimelineEvent, type LedgerEvent } from "./timeline-shape";

// LIVING CERTIFICATE — Section 2's fetch POLICY, kept pure.
//
// Pure: no I/O, no env, no `server-only`, so every branch is testable by import.
// The network call itself lives in timeline-fetch.ts, which is the thin
// server-only shell around these decisions — the same split the repo already
// uses for catalog-map.ts (policy) and linkspy/client.ts (shell).
//
// ═══ THE DISTINCTION EVERYTHING HANGS ON ═══
//   null  →  no timeline SECTION. We did not look successfully: no registry
//            annotation, LinkSpy unconfigured, flag off there, unreachable, or
//            a malformed body.
//   []    →  we DID look. The deliverable is registered and its ledger is empty.
//            Renders "Timeline begins after delivery."
//
// Collapsing those two would make a failed lookup read as "nothing has ever
// happened to your site", which is a statement we have no basis for.

export const TIMELINE_LIMIT = 100;
export const TIMELINE_CACHE_MS = 60 * 1000;
export const TIMELINE_TIMEOUT_MS = 4000;

/** The one URL this feature calls on LinkSpy. */
export function timelineUrl(
  base: string,
  deliverableId: string,
  limit: number = TIMELINE_LIMIT,
): string {
  const root = (base || "").replace(/\/$/, "");
  return (
    `${root}/api/registry-bridge/timeline` +
    `?registry_deliverable_id=${encodeURIComponent(deliverableId)}&limit=${limit}`
  );
}

/**
 * The ledger rows out of a response body, or null when the body is not one.
 *
 * A body we cannot read is a failed look, not an empty history.
 */
export function readLedger(body: unknown): LedgerEvent[] | null {
  if (!body || typeof body !== "object") return null;
  const events = (body as { events?: unknown }).events;
  return Array.isArray(events) ? (events as LedgerEvent[]) : null;
}

export type TimelineMemo = { events: ClientTimelineEvent[] | null; at: number } | undefined;

export function isFresh(memo: TimelineMemo, now: number, cacheMs = TIMELINE_CACHE_MS): boolean {
  return Boolean(memo) && now - memo!.at < cacheMs;
}

/**
 * What to serve after a fetch attempt.
 *
 * `ledger === null` means the attempt failed → staleness over errors: the last
 * known good if we have one, otherwise no section. A successful fetch is always
 * whitelisted before it is returned, so an unknown event type can never reach a
 * client's browser (deny by default — see timeline-shape.ts).
 */
export function serveTimeline(
  memo: TimelineMemo,
  ledger: LedgerEvent[] | null,
): { events: ClientTimelineEvent[] | null; store: boolean } {
  if (ledger === null) return { events: memo?.events ?? null, store: false };
  return { events: toClientTimeline(ledger), store: true };
}
