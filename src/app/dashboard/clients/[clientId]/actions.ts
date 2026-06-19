"use server";

import { revalidatePath } from "next/cache";
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

export async function deleteProject(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  const clientId = String(formData.get("clientId") ?? "");
  if (id) await db.project.delete({ where: { id } });
  revalidatePath(`/dashboard/clients/${clientId}`);
}
