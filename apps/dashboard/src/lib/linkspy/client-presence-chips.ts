import "server-only";
import { db } from "@/lib/db";
import { signHandoff } from "@/lib/handoff-contract";
import { linkspyAppUrl } from "./client";
import type { ClientPresence } from "./chips-shape";
import {
  presenceChipsEnabled,
  toClientPresence,
  type ClientPresencePayload,
} from "./client-presence-chips-shape";

// Re-exported so callers have one import site for this feature.
export { presenceChipsEnabled, toClientPresence };
export type { ClientPresencePayload };

// CLIENT PRESENCE CHIPS — the four chips for a client, aggregated by LinkSpy over
// every site it holds under `sites.client_id`.
//
// How this differs from the presence path (client-presence.ts), and why both
// exist: presence resolves sites from the DASHBOARD side (Page.registrySiteId —
// sites with a QA deliverable attached). Client presence chips resolves from the
// LINKSPY side (sites.client_id — everything in production for that client,
// including sites that never had a Dashboard deliverable). The second is a
// superset and is the better answer to "how is this client doing"; the first
// still answers "how are the things we built for them doing".
//
// Rendering is shared: both produce a ClientPresence and feed the SAME
// <ClientPresenceLine/>. No second renderer, no second chip vocabulary.

const CACHE_MS = 60 * 1000;
const TIMEOUT_MS = 4000;

type Cached = { payload: ClientPresencePayload; at: number };
const cache = new Map<string, Cached>();

function configured(): boolean {
  return Boolean(process.env.LINKSPY_API_URL && process.env.LINKSPY_API_KEY);
}

async function fetchPresenceChips(
  registryClientId: string,
): Promise<ClientPresencePayload | null> {
  const base = (process.env.LINKSPY_API_URL || "").replace(/\/$/, "");
  const key = process.env.LINKSPY_API_KEY || "";
  const url = `${base}/api/registry-bridge/client-presence?registry_client_id=${encodeURIComponent(registryClientId)}`;
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
    // 404 = the flag is off on LinkSpy. Not an error, just "nothing here".
    if (!res.ok) return null;
    return (await res.json()) as ClientPresencePayload;
  } catch {
    return null;
  }
}

export type PresenceChipsResult = {
  presence: ClientPresence | null;
  hrefByChip: Record<string, string>;
};

const HIDDEN: PresenceChipsResult = { presence: null, hrefByChip: {} };

/** Client presence chips for one client, or the hidden result on every failure. */
export async function getClientPresenceChips(
  clientId: string,
): Promise<PresenceChipsResult> {
  if (!presenceChipsEnabled() || !configured()) return HIDDEN;

  const client = await db.client
    .findUnique({ where: { id: clientId }, select: { name: true, registryClientId: true } })
    .catch(() => null);
  // No registry annotation ⇒ nothing to ask about. Renders nothing.
  if (!client?.registryClientId) return HIDDEN;

  const hit = cache.get(client.registryClientId);
  const fresh = hit && Date.now() - hit.at < CACHE_MS;

  let payload: ClientPresencePayload | null = fresh ? hit.payload : null;
  let stale = false;

  if (!fresh) {
    const got = await fetchPresenceChips(client.registryClientId);
    if (got) {
      cache.set(client.registryClientId, { payload: got, at: Date.now() });
      payload = got;
    } else {
      // Staleness over errors: last-known-good, labelled; else nothing at all.
      payload = hit?.payload ?? null;
      stale = Boolean(hit);
    }
  }

  const presence = toClientPresence(clientId, client.name, payload, stale);
  return { presence, hrefByChip: presence ? signChipLinks(presence) : {} };
}

// Signed server-side, ≤300s, and only for chips implicating exactly one site.
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

export function __resetPresenceChipsCache() {
  cache.clear();
}
