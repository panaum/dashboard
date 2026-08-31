import "server-only";
import { db } from "@/lib/db";
import { searchClients, clientSites } from "@/lib/registry";
import { signHandoff } from "@/lib/handoff-contract";
import { linkspyAppUrl } from "./client";
import type { SitesPayload } from "./chips-shape";
import type { PresencePayload } from "./presence-shape";
import type { RegistrySiteRow, ScanPayload } from "./sites-view";

// SITES DATA — server-side reads for /dashboard/sites. Same rules as every
// other LinkSpy fetch in this app: never throws, short timeout, the API key
// never leaves the server, and unavailability is a typed answer, not an error.

const TIMEOUT_MS = 5000;

function configured(): boolean {
  return Boolean(process.env.LINKSPY_API_URL && process.env.LINKSPY_API_KEY);
}

async function getJson<T>(path: string): Promise<T | null> {
  const base = (process.env.LINKSPY_API_URL || "").replace(/\/$/, "");
  const key = process.env.LINKSPY_API_KEY || "";
  try {
    const res = await fetch(`${base}${path}`, {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/** Every site the registry exposes (client-annotated on the LinkSpy side),
 *  tagged with its registry client's name. null = registry unavailable. */
export async function listRegistrySites(): Promise<RegistrySiteRow[] | null> {
  if (!configured()) return null;
  const clients = await searchClients("");
  if ("unavailable" in clients) return null;
  const perClient = await Promise.all(
    clients.clients.map(async (c) => {
      const r = await clientSites(c.id);
      if ("unavailable" in r) return [];
      return r.sites.map((s) => ({
        id: s.id, url: s.url ?? null, name: s.name ?? null, clientName: c.name,
      }));
    }),
  );
  return perClient.flat();
}

/** Dashboard pages linked per site id. */
export async function linkedPageCounts(siteIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!siteIds.length) return out;
  const rows = await db.page
    .groupBy({
      by: ["registrySiteId"],
      where: { registrySiteId: { in: siteIds } },
      _count: { _all: true },
    })
    .catch(() => []);
  for (const r of rows) {
    if (r.registrySiteId) out.set(r.registrySiteId, r._count._all);
  }
  return out;
}

/** The Dashboard pages linked to one site, for the detail view. */
export async function pagesForSite(siteId: string) {
  return db.page
    .findMany({
      where: { registrySiteId: siteId },
      select: {
        id: true, name: true, url: true,
        project: { select: { id: true, name: true, clientId: true, client: { select: { name: true } } } },
      },
      orderBy: { name: "asc" },
    })
    .catch(() => []);
}

export async function fetchSiteChips(siteIds: string[]): Promise<SitesPayload | null> {
  if (!configured() || !siteIds.length) return null;
  return getJson<SitesPayload>(
    `/api/qa-bridge/presence/sites?registry_site_ids=${encodeURIComponent(siteIds.join(","))}`,
  );
}

export async function fetchSitePresence(siteId: string): Promise<PresencePayload | null> {
  if (!configured()) return null;
  return getJson<PresencePayload>(
    `/api/qa-bridge/presence?registry_site_id=${encodeURIComponent(siteId)}`,
  );
}

export async function fetchSiteScan(siteId: string): Promise<ScanPayload | null> {
  if (!configured()) return null;
  return getJson<ScanPayload>(
    `/api/qa-bridge/site-scan?registry_site_id=${encodeURIComponent(siteId)}`,
  );
}

/** Signed "open in LinkSpy" href for a site path, or null when the handoff
 *  cannot be minted. Short-lived by design (HANDOFF_MAX_TTL_S); an expired
 *  click lands on LinkSpy's sign-in with a callback, never an error. */
export function linkspySiteHref(sitePath: string | null): string | null {
  const base = linkspyAppUrl();
  const secret = process.env.SPINE_SECRET;
  if (!sitePath || !base || !secret) return null;
  const token = signHandoff(sitePath, secret, Math.floor(Date.now() / 1000));
  return `${base.replace(/\/$/, "")}/handoff?token=${encodeURIComponent(token)}`;
}
