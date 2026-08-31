"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { memberSchema, parseForm, type ActionResult } from "@/lib/validation";

export async function saveMember(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = parseForm(memberSchema, formData);
  if ("error" in parsed) return { error: parsed.error };

  const id = String(formData.get("id") ?? "");
  try {
    if (id) {
      await db.teamMember.update({ where: { id }, data: parsed.data });
    } else {
      await db.teamMember.create({ data: parsed.data });
    }
  } catch (e) {
    if (e instanceof Error && e.message.includes("Unique"))
      return { error: "Someone with that name already exists." };
    return { error: "Could not save team member." };
  }

  revalidatePath("/dashboard/team");
  return { ok: true };
}

export async function deleteMember(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  // Pages referencing this member have their developer/tester set to null
  // automatically (onDelete: SetNull).
  if (id) await db.teamMember.delete({ where: { id } });
  revalidatePath("/dashboard/team");
}
