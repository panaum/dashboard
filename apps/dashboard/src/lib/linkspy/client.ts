import "server-only";
import { db } from "@/lib/db";
import {
  serveFromCache,
  serveAfterFetch,
  type LinkSpyStatusPayload,
  type ServedStatus,
} from "./catalog-map";

// Server-only LinkSpy client. The API key is read here and NEVER leaves the
// server — the internal page fetches status in its server component and passes
// only derived, non-secret annotations to the client checklist.

const CACHE_MS = 15 * 60 * 1000; // 15-minute freshness window
const TIMEOUT_MS = 6000;

export function linkspyConfigured(): boolean {
  return Boolean(process.env.LINKSPY_API_URL && process.env.LINKSPY_API_KEY);
}

// A deep link the operator can follow to LinkSpy to link/unlink this page, when
// the app base URL is known. Optional — the UI degrades to plain instructions.
export function linkspyAppUrl(): string | null {
  const u = process.env.LINKSPY_APP_URL || process.env.LINKSPY_API_URL || "";
  return u ? u.replace(/\/$/, "") : null;
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
    if (!res.ok) return null; // 401/429/5xx → treat as unreachable, fall back to cache
    return (await res.json()) as LinkSpyStatusPayload;
  } catch {
    return null; // network error / timeout → unreachable
  }
}

// 15-minute cache + durable last-known-good, both carried by the LinkSpyStatus
// row. Never throws and never blocks the page: LinkSpy down → serve cache (stale)
// → or null (module renders its quiet "not yet linked" state).
export async function getPageStatus(qaPageRef: string): Promise<ServedStatus | null> {
  if (!linkspyConfigured()) return null;

  const cached = await db.linkSpyStatus
    .findUnique({ where: { pageId: qaPageRef } })
    .then((r) => (r ? { payload: r.payload as LinkSpyStatusPayload, fetchedAt: r.fetchedAt } : null))
    .catch(() => null);

  const hit = serveFromCache(cached, Date.now(), CACHE_MS);
  if (hit.hit) return hit.status; // fresh (mapped → status, unmapped → null)

  const fresh = await fetchFresh(qaPageRef);
  if (fresh) {
    // persist the newest known-good (including a known {mapped:false})
    await db.linkSpyStatus
      .upsert({
        where: { pageId: qaPageRef },
        create: { pageId: qaPageRef, payload: fresh as object, fetchedAt: new Date() },
        update: { payload: fresh as object, fetchedAt: new Date() },
      })
      .catch(() => {});
  }
  return serveAfterFetch(cached, fresh, new Date());
}
