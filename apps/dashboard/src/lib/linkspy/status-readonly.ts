import "server-only";
import { db } from "@/lib/db";
import {
  serveFromCache,
  serveAfterFetch,
  type LinkSpyStatusPayload,
  type ServedStatus,
} from "./catalog-map";

// LIVING CERTIFICATE — the read-only sibling of getPageStatus() (F3).
//
// ═══ WHY THIS EXISTS ═══
// getPageStatus() in ./client.ts upserts the LinkSpyStatus row on every cache
// miss. That is correct for the internal page — an authenticated operator asked
// for it — but /live/{shareId} is an UNAUTHENTICATED public URL. If the public
// path used that helper, anyone holding a share link could make our database
// write on request, simply by reloading.
//
// So this helper reads the same row and fetches the same endpoint, and
// PERSISTS NOTHING. Freshness comes from a 60 s in-memory cache instead,
// mirroring client-presence-chips.ts.
//
// The durable row is still maintained — by the internal page, which is the only
// thing that should be writing it. This path is a passenger.
//
// ⚠ The payload it returns is LinkSpy's RAW status and must never be serialised
// to a client. Callers derive states from it (see living-certificate/health-shape.ts)
// and send only those. F10.

const CACHE_MS = 60 * 1000;
const TIMEOUT_MS = 4000;

type Memo = { status: ServedStatus | null; at: number };
const memo = new Map<string, Memo>();

function configured(): boolean {
  return Boolean(process.env.LINKSPY_API_URL && process.env.LINKSPY_API_KEY);
}

async function fetchFresh(qaPageRef: string): Promise<LinkSpyStatusPayload | null> {
  const base = (process.env.LINKSPY_API_URL || "").replace(/\/$/, "");
  const key = process.env.LINKSPY_API_KEY || "";
  const url = `${base}/api/qa-bridge/status?qa_page_ref=${encodeURIComponent(qaPageRef)}`;
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
    if (!res.ok) return null; // 401/429/5xx → unreachable, fall back to the row
    return (await res.json()) as LinkSpyStatusPayload;
  } catch {
    return null; // network error / timeout → unreachable
  }
}

/**
 * Live status for one page, without ever writing.
 *
 * Never throws and never blocks the render: LinkSpy unreachable → the durable
 * last-known-good row (marked `stale`) → or null, and the strip renders its
 * unknown state. Staleness over errors.
 */
export async function getPageStatusReadOnly(
  qaPageRef: string,
): Promise<ServedStatus | null> {
  if (!configured() || !qaPageRef) return null;

  const hit = memo.get(qaPageRef);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.status;

  // The durable row is READ here and nowhere written. The internal page owns it.
  const cached = await db.linkSpyStatus
    .findUnique({
      where: { pageId: qaPageRef },
      select: { payload: true, fetchedAt: true },
    })
    .then((r) =>
      r ? { payload: r.payload as LinkSpyStatusPayload, fetchedAt: r.fetchedAt } : null,
    )
    .catch(() => null);

  const fromRow = serveFromCache(cached, Date.now(), CACHE_MS);
  if (fromRow.hit) {
    memo.set(qaPageRef, { status: fromRow.status, at: Date.now() });
    return fromRow.status;
  }

  const fresh = await fetchFresh(qaPageRef);
  const status = serveAfterFetch(cached, fresh, new Date());
  memo.set(qaPageRef, { status, at: Date.now() });
  return status;
}

/** Test seam — the in-memory cache is process-wide. */
export function __resetStatusReadOnlyCache() {
  memo.clear();
}
