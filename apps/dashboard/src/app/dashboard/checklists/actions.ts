"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";

const BASE = "/dashboard/checklists";

export async function createTemplate(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim() || "Untitled checklist";
  const t = await db.checklistTemplate.create({ data: { name } });
  revalidatePath(BASE);
  redirect(`${BASE}/${t.id}`);
}

export async function updateTemplate(input: {
  id: string;
  name: string;
  platform: string | null;
  isDefault: boolean;
}) {
  if (input.isDefault) {
    await db.checklistTemplate.updateMany({
      where: { isDefault: true, NOT: { id: input.id } },
      data: { isDefault: false },
    });
  }
  await db.checklistTemplate.update({
    where: { id: input.id },
    data: {
      name: input.name.trim() || "Untitled checklist",
      platform: input.platform || null,
      isDefault: input.isDefault,
    },
  });
  revalidatePath(BASE);
  revalidatePath(`${BASE}/${input.id}`);
  return { ok: true };
}

export async function deleteTemplate(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (id) await db.checklistTemplate.delete({ where: { id } });
  revalidatePath(BASE);
  redirect(BASE);
}

export async function addTemplateItem(input: {
  templateId: string;
  category: string;
  name: string;
  hasDualValue: boolean;
  isMeasurement: boolean;
}) {
  const name = input.name.trim();
  if (!name) return { error: "Name is required." };
  const category = input.category.trim() || "General";
  const max = await db.checklistTemplateItem.aggregate({
    where: { templateId: input.templateId },
    _max: { order: true },
  });
  await db.checklistTemplateItem.create({
    data: {
      templateId: input.templateId,
      category,
      name,
      hasDualValue: input.hasDualValue,
      isMeasurement: input.isMeasurement,
      order: (max._max.order ?? -1) + 1,
    },
  });
  revalidatePath(`${BASE}/${input.templateId}`);
  return { ok: true };
}

export async function deleteTemplateItem(input: { id: string; templateId: string }) {
  await db.checklistTemplateItem.delete({ where: { id: input.id } });
  revalidatePath(`${BASE}/${input.templateId}`);
  return { ok: true };
}
