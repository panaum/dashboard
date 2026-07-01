"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { STATUSES } from "@/lib/constants";

/** Move a deliverable to a new pipeline status from the board (drag/drop). */
export async function movePage(input: { pageId: string; status: string }) {
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
