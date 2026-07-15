import "server-only";

// Server-only client for the LinkSpy Registry (Seam 1). The API key is read here
// and NEVER reaches the browser — the client component talks to our own proxy
// routes, which call this. Staleness/graceful over errors: unreachable or 503 →
// a typed "unavailable" result, never a throw.

const TIMEOUT_MS = 6000;

export function registryConfigured(): boolean {
  return Boolean(process.env.LINKSPY_API_URL && process.env.LINKSPY_API_KEY);
}

type Unavailable = { unavailable: true };
export type RegistryClient = { id: string; name: string };
export type RegistrySite = { id: string; name: string | null; url: string | null };

function base(): string {
  return (process.env.LINKSPY_API_URL || "").replace(/\/$/, "");
}
function authHeaders(): Record<string, string> {
  return { Authorization: `Bearer ${process.env.LINKSPY_API_KEY || ""}` };
}

async function getJson(path: string): Promise<any | Unavailable> {
  if (!registryConfigured()) return { unavailable: true };
  try {
    const res = await fetch(`${base()}${path}`, {
      headers: authHeaders(), signal: AbortSignal.timeout(TIMEOUT_MS), cache: "no-store",
    });
    if (res.status === 503 || !res.ok) return { unavailable: true };
    return await res.json();
  } catch {
    return { unavailable: true };
  }
}

export async function searchClients(q: string): Promise<{ clients: RegistryClient[] } | Unavailable> {
  const r = await getJson(`/api/registry/clients?search=${encodeURIComponent(q || "")}`);
  if ("unavailable" in r) return r;
  return { clients: r.clients ?? [] };
}

export async function clientSites(clientId: string): Promise<{ sites: RegistrySite[] } | Unavailable> {
  const r = await getJson(`/api/registry/clients/${encodeURIComponent(clientId)}/sites`);
  if ("unavailable" in r) return r;
  return { sites: r.sites ?? [] };
}

export type CreateResult =
  | { deliverable: { id: string } }
  | { unavailable: true }
  | { notProvisioned: true }
  | { conflict: true };

export async function createDeliverable(input: {
  siteId: string; kind?: string; name: string; externalRef: string; url?: string | null;
}): Promise<CreateResult> {
  if (!registryConfigured()) return { unavailable: true };
  try {
    const res = await fetch(`${base()}/api/registry/deliverables`, {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
      body: JSON.stringify({
        site_id: input.siteId, kind: input.kind ?? "page", name: input.name,
        external_ref: input.externalRef, url: input.url ?? undefined,
      }),
    });
    if (res.status === 503) return { notProvisioned: true };
    if (res.status === 409) return { conflict: true };
    if (!res.ok) return { unavailable: true };
    const body = await res.json();
    return { deliverable: body.deliverable };
  } catch {
    return { unavailable: true };
  }
}
