"use server";

import { redirect } from "next/navigation";
import { checkMemberPassword, checkPassword, createSession } from "@/lib/auth";

export async function login(
  _prev: { error?: string } | undefined,
  formData: FormData,
): Promise<{ error?: string }> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  // With an email, sign in as that person. Without one, fall back to the shared
  // team password — kept so that adopting per-person logins cannot lock anyone
  // out mid-migration. That session is admin but anonymous, and cannot sign QA.
  if (email) {
    const memberId = await checkMemberPassword(email, password);
    if (!memberId) return { error: "Incorrect email or password." };
    await createSession(memberId);
    redirect("/dashboard");
  }

  if (!checkPassword(password)) return { error: "Incorrect password." };
  await createSession();
  redirect("/dashboard");
}
