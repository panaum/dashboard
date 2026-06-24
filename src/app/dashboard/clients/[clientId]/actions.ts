"use server";

import { revalidatePath } from "next/cache";
import { randomBytes } from "node:crypto";
import { db } from "@/lib/db";
import { projectSchema, parseForm, type ActionResult } from "@/lib/validation";
import { createPageWithCert } from "./[projectId]/actions";

export async function saveProject(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const clientId = String(formData.get("clientId") ?? "");
  if (!clientId) return { error: "Missing client." };

  const parsed = parseForm(projectSchema, formData);
  if ("error" in parsed) return { error: parsed.error };

  // Landing pages are a single page, so the project form also assigns its
  // developer/tester (which actually live on the page).
  const developerId = String(formData.get("developerId") ?? "") || null;
  const testerId = String(formData.get("testerId") ?? "") || null;

  const id = String(formData.get("id") ?? "");
  try {
    if (id) {
      await db.project.update({ where: { id }, data: parsed.data });
      if (parsed.data.type === "LANDING_PAGE") {
        await db.page.updateMany({
          where: { projectId: id },
          data: { developerId, testerId },
        });
      }
    } else {
      const project = await db.project.create({
        data: { ...parsed.data, clientId },
      });
      // A landing page is a single page — create it (with its QA cert) up front.
      if (project.type === "LANDING_PAGE") {
        await createPageWithCert(project.id, {
          name: project.name,
          url: project.url,
          status: project.status,
          developerId,
          testerId,
        });
      }
    }
  } catch {
    return { error: "Could not save project." };
  }

  revalidatePath(`/dashboard/clients/${clientId}`);
  revalidatePath("/dashboard");
  return { ok: true };
}

// --- Public client portal link ---------------------------------------------

/**
 * Create (or return existing) a public portal token for this client. The token
 * authorises a read-only `/portal/[portalId]` view of every deliverable and its
 * certificate — no per-page links or login required.
 */
export async function createPortalLink(input: { clientId: string }) {
  const existing = await db.client.findUnique({
    where: { id: input.clientId },
    select: { portalId: true },
  });
  let portalId = existing?.portalId ?? null;
  if (!portalId) {
    portalId = randomBytes(12).toString("base64url");
    await db.client.update({
      where: { id: input.clientId },
      data: { portalId },
    });
  }
  revalidatePath(`/dashboard/clients/${input.clientId}`);
  return { ok: true as const, portalId };
}

/** Revoke the portal — the link stops working immediately. */
export async function revokePortalLink(input: { clientId: string }) {
  await db.client.update({
    where: { id: input.clientId },
    data: { portalId: null },
  });
  revalidatePath(`/dashboard/clients/${input.clientId}`);
  return { ok: true as const };
}

export async function deleteProject(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  const clientId = String(formData.get("clientId") ?? "");
  if (id) await db.project.delete({ where: { id } });
  revalidatePath(`/dashboard/clients/${clientId}`);
}
