"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getActor, hashPassword } from "@/lib/auth";
import { RANKS, type Rank, can } from "@/lib/permissions";
import { memberSchema, parseForm, type ActionResult } from "@/lib/validation";

// Every action here re-checks for itself. Hiding the page from the sidebar and
// guarding the route are courtesies to the reader; a server action is directly
// POST-able by anyone with a session, so the check has to live here too.
async function guard(capability: Parameters<typeof can>[1]) {
  const actor = await getActor();
  return can(actor, capability) ? actor! : null;
}

export async function saveMember(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  if (!(await guard("team:manage"))) return { error: "You cannot manage the team." };
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
  if (!(await guard("team:manage"))) return;
  const id = String(formData.get("id") ?? "");
  // Pages referencing this member have their developer/tester set to null
  // automatically (onDelete: SetNull).
  if (id) await db.teamMember.delete({ where: { id } });
  revalidatePath("/dashboard/team");
}

/** Change what someone may do. */
export async function setRank(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const actor = await guard("rank:assign");
  if (!actor) return { error: "You cannot change access levels." };

  const id = String(formData.get("id") ?? "");
  const rank = String(formData.get("rank") ?? "");
  if (!id || !(RANKS as readonly string[]).includes(rank)) {
    return { error: "Pick a valid access level." };
  }
  // Demoting yourself out of ADMIN would leave you unable to undo it. The
  // shared bootstrap session is exempt: it has no member row to demote.
  if (!actor.bootstrap && id === actor.id && rank !== "ADMIN") {
    return { error: "You cannot remove your own admin access. Ask another admin." };
  }
  // The last admin standing keeps the lights on.
  if (rank !== "ADMIN") {
    const admins = await db.teamMember.count({ where: { rank: "ADMIN", active: true } });
    const target = await db.teamMember.findUnique({ where: { id }, select: { rank: true } });
    if (admins <= 1 && target?.rank === "ADMIN") {
      return { error: "This is the only admin. Promote someone else first." };
    }
  }

  await db.teamMember.update({ where: { id }, data: { rank: rank as Rank } });
  revalidatePath("/dashboard/team");
  return { ok: true };
}

/** Give someone a login, or reset one. Passwords are set by an admin: there is
 *  no mail service wired up, so a self-serve reset would have nowhere to send. */
export async function setLogin(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  if (!(await guard("team:manage"))) return { error: "You cannot manage the team." };

  const id = String(formData.get("id") ?? "");
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  if (!id) return { error: "Missing member." };
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { error: "Enter a valid email address." };
  if (password && password.length < 12) {
    return { error: "Use at least 12 characters — this password is set by hand and rarely changed." };
  }

  try {
    await db.teamMember.update({
      where: { id },
      data: { email, ...(password ? { passwordHash: hashPassword(password) } : {}) },
    });
  } catch (e) {
    if (e instanceof Error && e.message.includes("Unique")) {
      return { error: "That email is already used by another member." };
    }
    return { error: "Could not save the login." };
  }
  revalidatePath("/dashboard/team");
  return { ok: true };
}
