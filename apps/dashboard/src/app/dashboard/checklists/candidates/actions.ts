"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { spineEmitEnabled, emitItemPromoted } from "@/lib/spine-emit";

// PROMOTE — the ONLY writer of ChecklistTemplateItem (T4), human-initiated.
// Adds the item to the default template with origin='flywheel'; existing pages'
// QACheckItems are NOT touched (they seeded at creation). Rationale is MANDATORY
// and enforced HERE (server-side), not just in the UI. Emits checklist.item_promoted
// (gated by SPINE_EMIT) so LinkSpy absorbs the check.
export async function promoteCandidate(input: {
  candidateId: string;
  wording: string;
  rationale: string;
  category?: string;
}): Promise<{ ok?: true; error?: string }> {
  await requireAuth();
  const wording = (input.wording ?? "").trim();
  const rationale = (input.rationale ?? "").trim();
  if (!rationale) return { error: "A one-sentence rationale is required to promote." };
  if (!wording) return { error: "Proposed wording cannot be empty." };
  const category = (input.category ?? "").trim() || "Flywheel";

  try {
    await db.$transaction(async (tx) => {
      const cand = await tx.checklistCandidate.findUnique({ where: { id: input.candidateId } });
      if (!cand) throw new Error("Candidate not found.");
      if (cand.status !== "draft") throw new Error("Already decided.");

      const tpl =
        (await tx.checklistTemplate.findFirst({ where: { isDefault: true } })) ??
        (await tx.checklistTemplate.findFirst({ orderBy: { createdAt: "asc" } }));
      if (!tpl) throw new Error("No checklist template to promote into.");

      const agg = await tx.checklistTemplateItem.aggregate({
        where: { templateId: tpl.id }, _max: { order: true },
      });
      await tx.checklistTemplateItem.create({
        data: {
          templateId: tpl.id, category, name: wording,
          order: (agg._max.order ?? -1) + 1,
          origin: "flywheel", originAt: new Date(),
        },
      });

      await tx.checklistCandidate.update({
        where: { id: cand.id },
        data: { status: "promoted", rationale, decidedBy: "agency", decidedAt: new Date() },
      });

      if (spineEmitEnabled()) {
        const ev = (cand.evidence ?? {}) as Record<string, unknown>;
        await emitItemPromoted(tx, {
          candidateRef: cand.linkspyCandidateRef,
          checkKey: (ev.proposed_check_key as string) ?? null,
          wording, machineVerifiable: cand.machineVerifiable, category,
        });
      }
    });
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Could not promote." };
  }

  revalidatePath("/dashboard/checklists/candidates");
  revalidatePath("/dashboard/checklists");
  return { ok: true };
}

// DISMISS — status + optional reason. Emits nothing, writes no template item.
export async function dismissCandidate(input: {
  candidateId: string;
  reason?: string;
}): Promise<{ ok?: true; error?: string }> {
  await requireAuth();
  try {
    await db.checklistCandidate.update({
      where: { id: input.candidateId },
      data: { status: "dismissed", reason: (input.reason ?? "").trim() || null, decidedBy: "agency", decidedAt: new Date() },
    });
  } catch {
    return { error: "Could not dismiss." };
  }
  revalidatePath("/dashboard/checklists/candidates");
  return { ok: true };
}
