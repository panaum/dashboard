import "server-only";
import { db } from "@/lib/db";
import { signHandoff } from "@/lib/handoff-contract";
import { linkspyAppUrl } from "./client";
import {
  clientPresence,
  presenceEnabled,
  type ClientPresence,
  type SitesPayload,
} from "./chips-shape";

// CLIENT PRESENCE — server-side fetch of per-site chips for a set of clients.
// 60s cache here; LinkSpy holds its own 5-minute per-site window.
//
// Same three rules as the page-level strip: never throws, never blocks (one
// short timeout, then cache or nothing), and the API key never leaves the
// server. Presence is derived state and is never persisted.

const CACHE_MS = 60 * 1000;
const TIMEOUT_MS = 4000;
const MAX_IDS = 250; // matches the producer's cap

type Cached = { payload: SitesPayload; at: number };
let cache: Cached | null = null;
let cacheKey = "";

function configured(): boolean {
  return Boolean(process.env.LINKSPY_API_URL && process.env.LINKSPY_API_KEY);
}

async function fetchChips(siteIds: string[]): Promise<SitesPayload | null> {
  const base = (process.env.LINKSPY_API_URL || "").replace(/\/$/, "");
  const key = process.env.LINKSPY_API_KEY || "";
  const url = `${base}/api/qa-bridge/presence/sites?registry_site_ids=${encodeURIComponent(siteIds.join(","))}`;
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
    if (!res.ok) return null;
    return (await res.json()) as SitesPayload;
  } catch {
    return null;
  }
}

/** Distinct LinkSpy site ids per Dashboard client, from the page annotations. */
export async function siteIdsByClient(clientIds: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (!clientIds.length) return out;
  const rows = await db.page
    .findMany({
      where: { registrySiteId: { not: null }, project: { clientId: { in: clientIds } } },
      select: { registrySiteId: true, project: { select: { clientId: true } } },
    })
    .catch(() => []);
  for (const r of rows) {
    if (!r.registrySiteId) continue;
    const list = out.get(r.project.clientId) ?? [];
    if (!list.includes(r.registrySiteId)) list.push(r.registrySiteId);
    out.set(r.project.clientId, list);
  }
  return out;
}

export type ClientPresenceResult = {
  presence: ClientPresence | null;
  hrefByChip: Record<string, string>;
};

const HIDDEN: ClientPresenceResult = { presence: null, hrefByChip: {} };

/** Presence for ONE client — used by the client detail page (server-rendered). */
export async function getClientPresence(
  clientId: string,
  clientName: string,
): Promise<ClientPresenceResult> {
  if (!presenceEnabled() || !configured()) return HIDDEN;

  const siteIds = (await siteIdsByClient([clientId])).get(clientId) ?? [];
  if (!siteIds.length) return HIDDEN; // unmapped client → render nothing

  const { payload, stale } = await load(siteIds);
  if (!payload) return HIDDEN;

  const presence = clientPresence({ clientId, clientName, siteIds, payload, stale });
  return { presence, hrefByChip: presence ? signChipLinks(presence) : {} };
}

/** Presence for MANY clients — used by the list dots (fetched after paint). */
export async function getClientPresenceMany(
  clients: { id: string; name: string }[],
): Promise<ClientPresence[]> {
  if (!presenceEnabled() || !configured() || !clients.length) return [];

  const byClient = await siteIdsByClient(clients.map((c) => c.id));
  const allIds = [...new Set([...byClient.values()].flat())];
  if (!allIds.length) return [];

  if (allIds.length > MAX_IDS) {
    // No silent caps — say what was dropped, server-side.
    console.warn(
      `[presence] ${allIds.length} linked sites exceeds the ${MAX_IDS}-id cap; ` +
        `${allIds.length - MAX_IDS} will render no dot`,
    );
  }

  const { payload, stale } = await load(allIds.slice(0, MAX_IDS));
  if (!payload) return [];

  return clients
    .map((c) =>
      clientPresence({
        clientId: c.id,
        clientName: c.name,
        siteIds: byClient.get(c.id) ?? [],
        payload,
        stale,
      }),
    )
    .filter((p): p is ClientPresence => p !== null);
}

// 60s window keyed on the exact id set, so the list and a detail page don't
// serve each other a partial answer.
async function load(siteIds: string[]): Promise<{ payload: SitesPayload | null; stale: boolean }> {
  const key = [...siteIds].sort().join(",");
  if (cache && cacheKey === key && Date.now() - cache.at < CACHE_MS) {
    return { payload: cache.payload, stale: false };
  }
  const fresh = await fetchChips(siteIds);
  if (fresh) {
    cache = { payload: fresh, at: Date.now() };
    cacheKey = key;
    return { payload: fresh, stale: false };
  }
  // Staleness over errors: last-known-good for this same id set, or nothing.
  if (cache && cacheKey === key) return { payload: cache.payload, stale: true };
  return { payload: null, stale: false };
}

// Signed server-side, ≤300s. Only chips implicating exactly ONE site get a
// link — pointing "3 sites have SSL trouble" at one of them would be a lie.
function signChipLinks(presence: ClientPresence): Record<string, string> {
  const base = linkspyAppUrl();
  const secret = process.env.SPINE_SECRET || "";
  if (!base || !secret) return {};
  const now = Math.floor(Date.now() / 1000);
  const out: Record<string, string> = {};
  for (const chip of presence.chips) {
    if (!chip.sitePath) continue;
    out[chip.key] = `${base}/handoff?token=${encodeURIComponent(signHandoff(chip.sitePath, secret, now))}`;
  }
  return out;
}

export function __resetClientPresenceCache() {
  cache = null;
  cacheKey = "";
}
