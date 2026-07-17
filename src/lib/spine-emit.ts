import "server-only";
import type { Prisma } from "@prisma/client";
import { EVENT_TYPES } from "@/lib/spine-contract";

// Spine emission (Phase 2B). Rows are written in the SAME transaction as the
// status change (Constitution rule 2). Gated by SPINE_EMIT — unset/0 means no
// row is ever written, so the status actions behave byte-identically to today.
export function spineEmitEnabled(): boolean {
  return process.env.SPINE_EMIT === "1";
}

type Tx = Prisma.TransactionClient;

export async function emitReadyForQa(
  tx: Tx,
  p: { pageId: string; url: string | null; name: string; registryDeliverableId: string | null; registrySiteId: string | null },
): Promise<void> {
  await tx.spineOutbox.create({
    data: {
      type: EVENT_TYPES.READY_FOR_QA,
      registryDeliverableId: p.registryDeliverableId,
      registrySiteId: p.registrySiteId,
      payload: { qa_page_ref: p.pageId, url: p.url ?? "", name: p.name },
    },
  });
}

export async function emitQaCompleted(
  tx: Tx,
  p: {
    pageId: string; registryDeliverableId: string | null; registrySiteId: string | null;
    summary: { passed: number; failed: number; na: number };
  },
): Promise<void> {
  await tx.spineOutbox.create({
    data: {
      type: EVENT_TYPES.QA_COMPLETED,
      registryDeliverableId: p.registryDeliverableId,
      registrySiteId: p.registrySiteId,
      payload: { qa_page_ref: p.pageId, checklist_summary: p.summary },
    },
  });
}

// Flywheel (Phase 5): a human PROMOTE emits checklist.item_promoted so LinkSpy
// absorbs the check into its catalog. Gated by SPINE_EMIT like the others.
export async function emitItemPromoted(
  tx: Tx,
  p: { candidateRef: string; checkKey: string | null; wording: string; machineVerifiable: boolean; category: string },
): Promise<void> {
  await tx.spineOutbox.create({
    data: {
      type: EVENT_TYPES.ITEM_PROMOTED,
      payload: {
        candidate_ref: p.candidateRef, check_key: p.checkKey, wording: p.wording,
        machine_verifiable: p.machineVerifiable, category: p.category,
      },
    },
  });
}
