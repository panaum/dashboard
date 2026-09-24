"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getActor } from "@/lib/auth";
import { profileSchema, rankRequestSchema, parseForm, type ActionResult } from "@/lib/validation";
import { accessState } from "@/lib/onboarding";

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
