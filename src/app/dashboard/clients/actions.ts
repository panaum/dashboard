"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { clientSchema, parseForm, type ActionResult } from "@/lib/validation";

export async function saveClient(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = parseForm(clientSchema, formData);
  if ("error" in parsed) return { error: parsed.error };

  const id = String(formData.get("id") ?? "");
  try {
    if (id) {
      await db.client.update({ where: { id }, data: parsed.data });
    } else {
      await db.client.create({ data: parsed.data });
    }
  } catch (e) {
    if (e instanceof Error && e.message.includes("Unique"))
      return { error: "A client with that name already exists." };
    return { error: "Could not save client." };
  }

  revalidatePath("/dashboard/clients");
  revalidatePath("/dashboard");
  return { ok: true };
}

export async function deleteClient(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  if (id) await db.client.delete({ where: { id } });
  revalidatePath("/dashboard/clients");
  redirect("/dashboard/clients");
}
