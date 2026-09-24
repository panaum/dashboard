"use server";

import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { actorWith, endPreviewCookie, startPreviewCookie } from "@/lib/auth";
import { isPreviewableRank } from "@/lib/preview";

// "View as": an admin sees the app exactly as a rank, or one person, would.
// Starting one is rank:assign — the same right as changing someone's rank —
// and a preview in progress is read-only (see previewOf in auth.ts), which is
// also why a new one cannot be started from inside one: exit first.

export async function startPreview(input: { rank?: string; memberId?: string }): Promise<{ error?: string }> {
  if (!(await actorWith("rank:assign"))) return { error: "Only an admin can preview another access level." };

  if (input.memberId) {
    const m = await db.teamMember.findUnique({ where: { id: input.memberId }, select: { rank: true, active: true } });
    if (!m || !m.active) return { error: "That person is no longer on the team." };
    if (!isPreviewableRank(m.rank)) return { error: "Admins see what you see — there is nothing to preview." };
    await startPreviewCookie({ kind: "member", memberId: input.memberId });
  } else if (input.rank && isPreviewableRank(input.rank)) {
    await startPreviewCookie({ kind: "rank", rank: input.rank });
  } else {
    return { error: "Pick Member or Viewer." };
  }
  redirect("/dashboard");
}

/** Leave the preview. Never gated: it only deletes the caller's own preview
 *  cookie, and it has to work while every other action is read-only. */
export async function exitPreview(): Promise<void> {
  await endPreviewCookie();
  redirect("/dashboard/team");
}
