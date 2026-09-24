"use server";

import { redirect } from "next/navigation";
import { checkMemberPassword, checkPassword, createSession } from "@/lib/auth";
import { db } from "@/lib/db";

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
    // The column existed from the start but nothing wrote it, so there was no
    // way to tell who had ever signed in (the onboarding backfill had to fall
    // back to "has a password").
    await db.teamMember.update({ where: { id: memberId }, data: { lastLoginAt: new Date() } });
    await createSession(memberId);
    redirect("/dashboard");
  }

  if (!checkPassword(password)) return { error: "Incorrect password." };
  await createSession();
  redirect("/dashboard");
}
