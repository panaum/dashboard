"use server";

import { redirect } from "next/navigation";
import { checkPassword, createSession } from "@/lib/auth";

export async function login(
  _prev: { error?: string } | undefined,
  formData: FormData,
): Promise<{ error?: string }> {
  const password = String(formData.get("password") ?? "");
  if (!checkPassword(password)) {
    return { error: "Incorrect password." };
  }
  await createSession();
  // Honor a safe relative callbackUrl (used by /handoff for signed-out links);
  // reject anything that isn't an app-relative path (no open redirects).
  const cb = String(formData.get("callbackUrl") ?? "");
  const safe = cb.startsWith("/") && !cb.startsWith("//") ? cb : "/dashboard";
  redirect(safe);
}
