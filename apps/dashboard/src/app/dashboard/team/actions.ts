"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getActor, hashPassword } from "@/lib/auth";
import { type Actor, RANKS, type Rank, can } from "@/lib/permissions";
import { memberSchema, parseForm, type ActionResult } from "@/lib/validation";
import { roleForDesignation } from "@/lib/designations";

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
  // The work role comes from the designation rather than a second field the
  // two could disagree on. A designation typed in free text before that change
  // is not in the table, and rather than guess — or quietly demote somebody to
  // DEVELOPER — we leave the role they already had.
  const derived = roleForDesignation(parsed.data.title);
  try {
    if (id) {
      const existing = await db.teamMember.findUnique({ where: { id }, select: { role: true } });
      if (!existing) return { error: "That team member no longer exists." };
      await db.teamMember.update({
        where: { id },
        data: { ...parsed.data, role: derived ?? existing.role },
      });
    } else {
      await db.teamMember.create({ data: { ...parsed.data, role: derived ?? "DEVELOPER" } });
    }
  } catch (e) {
    if (e instanceof Error && e.message.includes("Unique"))
      return { error: "Someone with that name already exists." };
    return { error: "Could not save team member." };
  }

  revalidatePath("/dashboard/team");
  return { ok: true };
}

const AVATAR_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const MAX_AVATAR_BYTES = 512 * 1024; // the browser resizes to 256px first; this is the backstop

/** Set or replace a member's photo. The browser sends a 256×256 crop, so the
 *  cap is generous rather than load-bearing. Passing no file clears it. */
export async function setAvatar(formData: FormData): Promise<ActionResult> {
  const id = String(formData.get("id") ?? "");
  if (!id) return { error: "Missing member." };
  // Your own photo is never rank-gated (the profile page calls this same
  // action); anyone else's is team management.
  const actor = await getActor();
  const self = !!actor && !actor.bootstrap && !actor.preview && actor.id === id;
  if (!self && !can(actor, "team:manage")) return { error: "You cannot manage the team." };
  const file = formData.get("avatar");

  if (!(file instanceof File) || !file.size) {
    await db.teamMember.update({ where: { id }, data: { avatar: null, avatarType: null, avatarUpdatedAt: null } });
    revalidatePath("/dashboard/team");
    revalidatePath("/dashboard/profile");
    return { ok: true };
  }
  if (!AVATAR_TYPES.has(file.type)) return { error: "PNG, JPEG or WebP only." };
  if (file.size > MAX_AVATAR_BYTES) return { error: "That photo is too large even after resizing — try another." };

  const buf = Buffer.from(await file.arrayBuffer());
  await db.teamMember.update({
    where: { id },
    data: { avatar: buf, avatarType: file.type, avatarUpdatedAt: new Date() },
  });
  revalidatePath("/dashboard/team");
  revalidatePath("/dashboard/profile");
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
  return applyRank(actor, String(formData.get("id") ?? ""), String(formData.get("rank") ?? ""));
}

/** The one place a rank changes. The Team page's dropdown and approving a
 *  request both come through here, so the safety rules cannot drift apart.
 *  Callers have already checked rank:assign. */
async function applyRank(actor: Actor, id: string, rank: string): Promise<ActionResult> {
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

  const reviewer = actor.bootstrap ? null : actor.id;
  await db.$transaction([
    db.teamMember.update({ where: { id }, data: { rank: rank as Rank } }),
    // Giving someone, by the dropdown, the rank they had asked for answers
    // their request — it should not sit on the Team page waiting for a click
    // that no longer means anything.
    db.rankChangeRequest.updateMany({
      where: { requestedById: id, status: "pending", toRank: rank },
      data: { status: "approved", reviewedById: reviewer, reviewedAt: new Date() },
    }),
  ]);
  revalidatePath("/dashboard", "layout"); // the Team nav badge counts pending requests
  return { ok: true };
}

/** Approve a pending rank request: rank:assign, with the request as its
 *  audit trail. */
export async function approveRankRequest(input: { id: string }): Promise<ActionResult> {
  const actor = await guard("rank:assign");
  if (!actor) return { error: "You cannot change access levels." };
  const req = await db.rankChangeRequest.findUnique({
    where: { id: input.id }, select: { requestedById: true, toRank: true, status: true },
  });
  if (!req) return { error: "That request no longer exists." };
  if (req.status !== "pending") return { error: "That request has already been answered." };
  // applyRank marks this request approved in the same transaction.
  return applyRank(actor, req.requestedById, req.toRank);
}

/** Deny a pending rank request, optionally saying why. The rank is untouched;
 *  the note is shown to the requester on their profile. */
export async function denyRankRequest(input: { id: string; note?: string }): Promise<ActionResult> {
  const actor = await guard("rank:assign");
  if (!actor) return { error: "You cannot change access levels." };
  const note = (input.note ?? "").trim().slice(0, 500) || null;
  const r = await db.rankChangeRequest.updateMany({
    where: { id: input.id, status: "pending" },
    data: { status: "denied", reviewNote: note, reviewedById: actor.bootstrap ? null : actor.id, reviewedAt: new Date() },
  });
  if (!r.count) return { error: "That request has already been answered." };
  revalidatePath("/dashboard", "layout");
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
