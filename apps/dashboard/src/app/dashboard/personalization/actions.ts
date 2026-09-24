"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { destroySession, getActor } from "@/lib/auth";
import { redirect } from "next/navigation";
import { profileSchema, rankRequestSchema, parseForm, type ActionResult } from "@/lib/validation";
import { accessState } from "@/lib/onboarding";
import { NOTIFY_KINDS, type NotifyColumn, isTimeZone } from "@/lib/preferences";

// The signed-in person acting on their OWN row. None of this is rank-gated —
// personal settings never are — but every action refuses the shared-password
// session, which has no row to act on, and only ever touches actor.id: no id
// is read from the form, so there is nothing to point at somebody else.

const NO_ROW = { error: "Sign in as yourself to change your profile." };

async function self() {
  const actor = await getActor();
  // A preview is read-only: an admin viewing as someone edits nobody's profile.
  return actor && !actor.bootstrap && !actor.preview ? actor : null;
}

/** Name and nickname. Validation is the same schema the admin dialog uses. */
export async function saveProfile(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const actor = await self();
  if (!actor) return NO_ROW;
  const parsed = parseForm(profileSchema, formData);
  if ("error" in parsed) return { error: parsed.error };
  try {
    await db.teamMember.update({ where: { id: actor.id }, data: parsed.data });
  } catch (e) {
    if (e instanceof Error && e.message.includes("Unique")) return { error: "Someone with that name already exists." };
    return { error: "Could not save your profile." };
  }
  revalidatePath("/dashboard", "layout");
  return { ok: true };
}

/** Ask to become a Member. Refused unless accessState says this person may
 *  ask right now — the same function that decides whether the button shows —
 *  so a Member, an Admin, or someone already waiting cannot file another. */
export async function requestMemberAccess(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const actor = await self();
  if (!actor) return NO_ROW;
  const parsed = parseForm(rankRequestSchema, formData);
  if ("error" in parsed) return { error: parsed.error };

  const latest = await db.rankChangeRequest.findFirst({
    where: { requestedById: actor.id }, orderBy: { createdAt: "desc" },
  });
  const state = accessState(actor.rank, latest);
  if (state.kind === "pending") return { error: "Your request is already waiting for an admin." };
  if (!state.canRequest) return { error: "Your access level already includes Member access." };

  await db.rankChangeRequest.create({
    data: { requestedById: actor.id, fromRank: actor.rank, toRank: "MEMBER", reason: parsed.data.reason },
  });
  revalidatePath("/dashboard", "layout");
  return { ok: true };
}

/** Finished or skipped: written once, on this person's row, so it follows them
 *  to any device. Idempotent — a retaken tour calls it again harmlessly. */
export async function completeOnboarding(): Promise<ActionResult> {
  const actor = await self();
  if (!actor) return NO_ROW;
  await db.teamMember.update({ where: { id: actor.id }, data: { hasCompletedOnboarding: true } });
  revalidatePath("/dashboard", "layout");
  return { ok: true };
}

/**
 * Leave the workspace. A Viewer or Member may; an admin hands over first (the
 * last admin standing keeps the lights on, and rank is theirs to pass on).
 *
 * This DEACTIVATES rather than deletes. Deleting the row would null the
 * person out of every page they built or tested, every issue, board event and
 * comment — permanently, on a database with no point-in-time recovery. So the
 * row stays, sign-in stops (active=false; the password is cleared), and they
 * drop out of every assignment list. An admin can restore them from the Team
 * page, or delete them for good there.
 */
export async function leaveWorkspace(): Promise<ActionResult> {
  const actor = await self();
  if (!actor) return NO_ROW;
  if (actor.rank === "ADMIN") return { error: "Admins hand over before leaving — ask another admin to change your access first." };

  await db.$transaction([
    db.teamMember.update({ where: { id: actor.id }, data: { active: false, passwordHash: null } }),
    // A request nobody will be around to use.
    db.rankChangeRequest.updateMany({
      where: { requestedById: actor.id, status: "pending" },
      data: { status: "denied", reviewNote: "Left the workspace.", reviewedAt: new Date() },
    }),
  ]);
  await destroySession();
  redirect("/goodbye");
}

/** Turn one kind of Slack ping on or off, for yourself. Only the known
 *  columns are accepted — the column name comes from the client. */
export async function saveNotification(input: { column: string; on: boolean }): Promise<ActionResult> {
  const actor = await self();
  if (!actor) return NO_ROW;
  const known = NOTIFY_KINDS.map((k) => k.column) as readonly string[];
  if (!known.includes(input.column)) return { error: "Unknown notification." };
  await db.teamMember.update({ where: { id: actor.id }, data: { [input.column as NotifyColumn]: Boolean(input.on) } });
  revalidatePath("/dashboard/personalization");
  return { ok: true };
}

/** Your time zone, or null to follow the browser again. */
export async function saveTimeZone(input: { timeZone: string | null }): Promise<ActionResult> {
  const actor = await self();
  if (!actor) return NO_ROW;
  const tz = input.timeZone || null;
  if (tz !== null && !isTimeZone(tz)) return { error: "That is not a time zone this app recognises." };
  await db.teamMember.update({ where: { id: actor.id }, data: { timeZone: tz } });
  revalidatePath("/dashboard", "layout");
  return { ok: true };
}
