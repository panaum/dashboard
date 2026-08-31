import "server-only";
import type { ClientTimelineEvent } from "./timeline-shape";
import {
  timelineUrl,
  readLedger,
  serveTimeline,
  isFresh,
  type TimelineMemo,
  TIMELINE_CACHE_MS,
  TIMELINE_TIMEOUT_MS,
} from "./timeline-source";

// LIVING CERTIFICATE — Section 2, the network shell.
//
// Deliberately thin. Every decision — the URL, what counts as a readable body,
// null vs [], staleness over errors — lives in timeline-source.ts, which is pure
// and unit-tested. What is left here is env, fetch and a Map, which is the part
// that cannot be tested by import anyway (`server-only` does not resolve outside
// Next's bundler). Same split as catalog-map.ts + linkspy/client.ts.
//
// ═══ READ-ONLY, AND NO DATABASE AT ALL ═══
// This module imports no `db`. LinkSpy's timeline is an append-only ledger and
// this path only reads it. Freshness is a 60 s in-memory Map — nothing durable,
// so an anonymous visitor cannot make us write by reloading (F3).
//
// ═══ F10 ═══
// The service key is read here and never leaves the server. What crosses to a
// client is only what toClientTimeline() has whitelisted.

const memo = new Map<string, NonNullable<TimelineMemo>>();

function configured(): boolean {
  return Boolean(process.env.LINKSPY_API_URL && process.env.LINKSPY_API_KEY);
}

async function fetchLedger(deliverableId: string) {
  const url = timelineUrl(process.env.LINKSPY_API_URL || "", deliverableId);
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${process.env.LINKSPY_API_KEY || ""}` },
      signal: AbortSignal.timeout(TIMELINE_TIMEOUT_MS),
      cache: "no-store",
    });
    // 404 = LIVING_CERTIFICATE is off on LinkSpy, by that endpoint's own design
    // indistinguishable from the route not existing. Not an error, but also not
    // a successful look — readLedger's null path handles it.
    if (!res.ok) return null;
    return readLedger(await res.json());
  } catch {
    return null; // timeout / network / unparseable JSON
  }
}

/**
 * The client-safe timeline for one deliverable, or null when there is no
 * section to render. Never throws.
 */
export async function getClientTimeline(
  deliverableId: string | null | undefined,
): Promise<ClientTimelineEvent[] | null> {
  // No registry annotation ⇒ nothing to ask about, and no call is made. The
  // commonest case by far: as of this writing 0 of 265 pages carry one.
  if (!deliverableId || !configured()) return null;

  const cached = memo.get(deliverableId);
  if (isFresh(cached, Date.now(), TIMELINE_CACHE_MS)) return cached!.events;

  const { events, store } = serveTimeline(cached, await fetchLedger(deliverableId));
  if (store) memo.set(deliverableId, { events, at: Date.now() });
  return events;
}

/** Test seam — the in-memory cache is process-wide. */
export function __resetTimelineCache() {
  memo.clear();
}
