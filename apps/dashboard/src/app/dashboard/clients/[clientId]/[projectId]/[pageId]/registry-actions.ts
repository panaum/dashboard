"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { createDeliverable } from "@/lib/registry";

type Path = { clientId: string; projectId: string; pageId: string };

function pagePath(p: Path) {
  return `/dashboard/clients/${p.clientId}/${p.projectId}/${p.pageId}`;
}

// Link a QA page to a LinkSpy site: register a deliverable (external_ref = the
// page id) and annotate the local nullable columns. Annotation only — no
// existing QA field is mutated. Graceful: registry unavailable → typed error,
// page unchanged.
export async function linkPageToRegistry(input: {
  path: Path;
  siteId: string;
  registryClientId?: string | null;
  name: string;
  url?: string | null;
}): Promise<{ ok: true; siteId: string } | { error: string }> {
  const res = await createDeliverable({
    siteId: input.siteId, kind: "page", name: input.name,
    externalRef: input.path.pageId, url: input.url ?? undefined,
  });

  if ("unavailable" in res) return { error: "Registry unavailable — try again later." };
  if ("notProvisioned" in res) return { error: "Registry not provisioned yet (migration 022 pending)." };
  if ("conflict" in res) return { error: "This page is already linked in the registry." };

  await db.page.update({
    where: { id: input.path.pageId },
    data: { registryDeliverableId: res.deliverable.id, registrySiteId: input.siteId },
  });
  // Annotate the QA client with its registry client too (nullable; only set).
  if (input.registryClientId) {
    const page = await db.page.findUnique({
      where: { id: input.path.pageId },
      select: { project: { select: { clientId: true } } },
    });
    if (page?.project?.clientId) {
      await db.client.update({
        where: { id: page.project.clientId },
        data: { registryClientId: input.registryClientId },
      });
    }
  }
  revalidatePath(pagePath(input.path));
  return { ok: true, siteId: input.siteId };
}

// Unlink: null the LOCAL columns only. The LinkSpy-side deliverable is left in
// place (orphan-tolerated — an eternal id with no back-reference is harmless;
// a future reconcile may archive it). No mutation of any other QA field.
export async function unlinkPageFromRegistry(input: { path: Path }): Promise<{ ok: true }> {
  await db.page.update({
    where: { id: input.path.pageId },
    data: { registryDeliverableId: null, registrySiteId: null },
  });
  revalidatePath(pagePath(input.path));
  return { ok: true };
}
