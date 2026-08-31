import "server-only";
import { signHandoff } from "@/lib/handoff-contract";
import { linkspyAppUrl } from "./client";
import {
  decidePresence,
  presenceEnabled,
  type PresencePayload,
  type PresenceView,
} from "./presence-shape";

// PRESENCE (Seam 3) — server-side fetch of LinkSpy's production presence for a
// registry site. 60s cache + in-memory last-known-good.
//
// Three properties this file must never lose:
//   1. It NEVER throws. The checklist page renders with or without it.
//   2. It NEVER blocks: one short timeout, then we serve cache or nothing.
//   3. The API key never leaves the server, and handoff tokens are signed here.
//
// Deliberately in-memory (not a DB row like LinkSpyStatus): presence is derived,
// disposable state — Part C forbids storing it.

const CACHE_MS = 60 * 1000;
const TIMEOUT_MS = 4000;

type Cached = { payload: PresencePayload; at: number };
const cache = new Map<string, Cached>();

function configured(): boolean {
  return Boolean(process.env.LINKSPY_API_URL && process.env.LINKSPY_API_KEY);
}

async function fetchFresh(registrySiteId: string): Promise<PresencePayload | null> {
  const base = (process.env.LINKSPY_API_URL || "").replace(/\/$/, "");
  const key = process.env.LINKSPY_API_KEY || "";
  const url = `${base}/api/qa-bridge/presence?registry_site_id=${encodeURIComponent(registrySiteId)}`;
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
    if (!res.ok) return null; // 401/429/503/5xx → unreachable, fall back to cache
    return (await res.json()) as PresencePayload;
  } catch {
    return null; // network error / timeout → unreachable
  }
}

export type PresenceResult = { view: PresenceView; hrefByKey: Record<string, string> };

const HIDDEN: PresenceResult = { view: { render: false }, hrefByKey: {} };

/**
 * Everything the checklist page needs to render (or not render) the strip.
 * Returns the hidden view on every failure mode there is.
 */
export async function getProductionPresence(
  registrySiteId: string | null | undefined,
): Promise<PresenceResult> {
  if (!presenceEnabled() || !registrySiteId || !configured()) return HIDDEN;

  const hit = cache.get(registrySiteId);
  const fresh = hit && Date.now() - hit.at < CACHE_MS;

  let payload: PresencePayload | null = fresh ? hit.payload : null;
  let stale = false;
  let unreachable = false;

  if (!fresh) {
    const got = await fetchFresh(registrySiteId);
    if (got) {
      cache.set(registrySiteId, { payload: got, at: Date.now() });
      payload = got;
    } else {
      unreachable = true;
      // Staleness over errors (constitution rule 6): last-known-good, labelled.
      payload = hit?.payload ?? null;
      stale = Boolean(hit);
    }
  }

  const view = decidePresence({
    enabled: true,
    registrySiteId,
    payload,
    unreachable,
    stale,
  });

  return { view, hrefByKey: view.render && view.kind === "signals" ? signLinks(view.signals) : {} };
}

// Handoff tokens are minted HERE — server-side, short-lived (≤300s), one per
// signal. They remove the login wall; they are not auth (see handoff-contract).
function signLinks(signals: { key: string; deep_link_path: string | null }[]): Record<string, string> {
  const base = linkspyAppUrl();
  const secret = process.env.SPINE_SECRET || "";
  if (!base || !secret) return {};
  const now = Math.floor(Date.now() / 1000);
  const out: Record<string, string> = {};
  for (const s of signals) {
    if (!s.deep_link_path) continue;
    out[s.key] = `${base}/handoff?token=${encodeURIComponent(signHandoff(s.deep_link_path, secret, now))}`;
  }
  return out;
}

// Test seam only — the module-level cache would otherwise leak between cases.
export function __resetPresenceCache() {
  cache.clear();
}
