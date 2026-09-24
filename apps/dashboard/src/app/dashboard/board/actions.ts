"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { STATUSES } from "@/lib/constants";
import { actorWith } from "@/lib/auth";
import { CANNOT } from "@/lib/permissions";

/** Move a deliverable to a new pipeline status from the board (drag/drop). */
export async function movePage(input: { pageId: string; status: string }) {
  if (!(await actorWith("page:edit"))) return { error: CANNOT["page:edit"] };
  if (!(STATUSES as readonly string[]).includes(input.status)) {
    return { error: "Invalid status." as const };
  }
  await db.page.update({
    where: { id: input.pageId },
    data: { status: input.status },
  });
  revalidatePath("/dashboard/board");
  revalidatePath("/dashboard");
  return { ok: true as const };
}
