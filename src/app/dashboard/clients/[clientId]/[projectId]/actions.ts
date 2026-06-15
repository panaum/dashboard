"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { pageSchema, parseForm, type ActionResult } from "@/lib/validation";
import { buildChecklistItems } from "@/lib/qa-template";
import { STATUSES } from "@/lib/constants";

/** Inline status change from a page list (no full edit dialog). */
export async function setPageStatus(input: {
  pageId: string;
  status: string;
  clientId: string;
  projectId: string;
}) {
  if (!(STATUSES as readonly string[]).includes(input.status)) {
    return { error: "Invalid status." };
  }
  await db.page.update({
    where: { id: input.pageId },
    data: { status: input.status },
  });
  revalidatePath(`/dashboard/clients/${input.clientId}/${input.projectId}`);
  revalidatePath("/dashboard");
  return { ok: true };
}

/** Create a page plus its blank QA certificate (checklist seeded). */
export async function createPageWithCert(
  projectId: string,
  data: {
    name: string;
    url?: string | null;
    status?: string;
    developerId?: string | null;
    testerId?: string | null;
    delayDays?: number;
    deliveryMonth?: string | null;
  },
) {
  const page = await db.page.create({ data: { projectId, ...data } });
  const cert = await db.qACertificate.create({
    data: { pageId: page.id, status: "IN_PROGRESS" },
  });

  // Seed the checklist from the best-matching template: a template for this
  // project's platform, else the default, else the built-in QA_TEMPLATE.
  const project = await db.project.findUnique({
    where: { id: projectId },
    select: { platform: true },
  });
  let template = project
    ? await db.checklistTemplate.findFirst({
        where: { platform: project.platform },
        include: { items: { orderBy: { order: "asc" } } },
      })
    : null;
  if (!template) {
    template = await db.checklistTemplate.findFirst({
      where: { isDefault: true },
      include: { items: { orderBy: { order: "asc" } } },
    });
  }

  if (template && template.items.length > 0) {
    await db.qACheckItem.createMany({
      data: template.items.map((it, i) => ({
        certificateId: cert.id,
        category: it.category,
        name: it.name,
        result: "NA",
        hasDualValue: it.hasDualValue,
        isMeasurement: it.isMeasurement,
        order: i,
      })),
    });
  } else {
    await db.qACheckItem.createMany({ data: buildChecklistItems(cert.id) });
  }
  return page;
}

export async function savePage(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const projectId = String(formData.get("projectId") ?? "");
  const clientId = String(formData.get("clientId") ?? "");
  if (!projectId) return { error: "Missing project." };

  const parsed = parseForm(pageSchema, formData);
  if ("error" in parsed) return { error: parsed.error };

  const id = String(formData.get("id") ?? "");
  try {
    if (id) {
      await db.page.update({ where: { id }, data: parsed.data });
    } else {
      await createPageWithCert(projectId, parsed.data);
    }
  } catch {
    return { error: "Could not save page." };
  }

  revalidatePath(`/dashboard/clients/${clientId}/${projectId}`);
  revalidatePath("/dashboard");
  return { ok: true };
}

export async function deletePage(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  const projectId = String(formData.get("projectId") ?? "");
  const clientId = String(formData.get("clientId") ?? "");
  const redirectTo = String(formData.get("redirectTo") ?? "");
  if (id) await db.page.delete({ where: { id } });
  revalidatePath(`/dashboard/clients/${clientId}/${projectId}`);
  if (redirectTo) redirect(redirectTo);
}
