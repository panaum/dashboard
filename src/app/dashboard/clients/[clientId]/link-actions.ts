"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { clientIntelligenceEnabled } from "@/lib/linkspy/client-intelligence-shape";

// Link a Dashboard client to a LinkSpy registry client. The ONE write path this
// feature has, and it only ever runs from a human pressing "Link to LinkSpy" on
// a single client. No bulk sweep, no auto-link on read, no cron.
//
// It writes exactly one nullable annotation column (Client.registryClientId) and
// never touches a QA row.

export type LinkResult =
  | { ok: true; registryClientId: string; created: boolean; matchedBy: string }
  | { ok: false; error: string };

export async function linkClientToLinkSpy(
  clientId: string,
  linkspyClientId?: string,
): Promise<LinkResult> {
  if (!clientIntelligenceEnabled()) {
    return { ok: false, error: "Client intelligence is off." };
  }
  const base = (process.env.LINKSPY_API_URL || "").replace(/\/$/, "");
  const key = process.env.LINKSPY_API_KEY || "";
  if (!base || !key) return { ok: false, error: "LinkSpy is not configured." };

  const client = await db.client
    .findUnique({ where: { id: clientId }, select: { name: true, registryClientId: true } })
    .catch(() => null);
  if (!client) return { ok: false, error: "No such client." };
  // Idempotent: already linked is a success, not an error to shout about.
  if (client.registryClientId) {
    return { ok: true, registryClientId: client.registryClientId, created: false, matchedBy: "already-linked" };
  }

  let res: Response;
  try {
    res = await fetch(`${base}/api/registry-bridge/link-client`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        dashboard_client_id: clientId,
        name: client.name,
        linkspy_client_id: linkspyClientId || undefined,
      }),
      signal: AbortSignal.timeout(8000),
      cache: "no-store",
    });
  } catch {
    return { ok: false, error: "LinkSpy is unreachable — nothing was linked." };
  }

  if (res.status === 404) {
    // Either the flag is off upstream, or the pasted id doesn't exist. Both are
    // "we did not link anything", said plainly.
    return { ok: false, error: linkspyClientId ? "No LinkSpy client with that id." : "Client intelligence is off in LinkSpy." };
  }
  if (!res.ok) return { ok: false, error: `LinkSpy refused the link (${res.status}).` };

  const body = (await res.json()) as {
    linkspy_client_id?: string;
    created?: boolean;
    matched_by?: string;
  };
  if (!body.linkspy_client_id) return { ok: false, error: "LinkSpy returned no client id." };

  // Only now do we annotate — the registry id exists before we record it.
  await db.client.update({
    where: { id: clientId },
    data: { registryClientId: body.linkspy_client_id },
  });

  revalidatePath(`/dashboard/clients/${clientId}`);
  return {
    ok: true,
    registryClientId: body.linkspy_client_id,
    created: Boolean(body.created),
    matchedBy: body.matched_by ?? "unknown",
  };
}
