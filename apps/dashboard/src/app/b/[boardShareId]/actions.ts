"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { commentWithMentions, removeImage, setCoverImage, storeImage } from "@/app/dashboard/boards/actions";
import { boardStageSchema, commentSchema, parseForm, type ActionResult } from "@/lib/validation";
import { canMove, isStage, reorder } from "@/lib/boards";
import type { BoardStage } from "@/lib/constants";

// The developer's side. No session: the capability link IS the credential,
// so every action re-resolves the project from the token and refuses any
// card outside it. The developer never logs in, but they do exist as a
// TeamMember — the card's assignee — and that is who the event names.

async function boardFor(boardShareId: string) {
  if (!boardShareId) return null;
  return db.project.findUnique({ where: { boardShareId }, select: { id: true } });
}

async function cardIn(projectId: string, issueId: string) {
  return db.issue.findFirst({
    where: { id: issueId, page: { projectId }, boardStage: { not: null } },
    select: { id: true, boardStage: true, assigneeId: true },
  });
}

export async function developerMove(input: {
  boardShareId: string; id: string; to: BoardStage; index: number;
}): Promise<ActionResult> {
  const board = await boardFor(input.boardShareId);
  if (!board) return { error: "This link is no longer valid." };
  if (!isStage(input.to)) return { error: "Unknown stage." };
  const card = await cardIn(board.id, input.id);
  if (!card) return { error: "Card not found on this board." };
  const from = isStage(card.boardStage) ? card.boardStage : null;
  const sameStage = from === input.to;
  // A developer may only move a card assigned to them, and never through CLOSED.
  if (!sameStage && !canMove("developer", from, input.to, { assigned: !!card.assigneeId })) {
    return { error: "That move is QA's to make." };
  }
  const cards = await db.issue.findMany({
    where: { page: { projectId: board.id }, boardStage: { not: null } },
    select: { id: true, boardStage: true, boardOrder: true },
  });
  const writes = reorder(cards, input.to, input.id, input.index);
  await db.$transaction([
    ...writes.map((w) => db.issue.update({
      where: { id: w.id },
      data: w.id === input.id ? { boardStage: input.to, boardOrder: w.boardOrder } : { boardOrder: w.boardOrder },
    })),
    ...(sameStage ? [] : [db.issueEvent.create({
      data: { issueId: input.id, fromStage: from, toStage: input.to, actorId: card.assigneeId },
    })]),
  ]);
  revalidatePath(`/b/${input.boardShareId}`);
  return { ok: true };
}

export async function developerComment(formData: FormData): Promise<ActionResult> {
  const boardShareId = String(formData.get("boardShareId") ?? "");
  const issueId = String(formData.get("issueId") ?? "");
  const board = await boardFor(boardShareId);
  if (!board) return { error: "This link is no longer valid." };
  const card = await cardIn(board.id, issueId);
  if (!card) return { error: "Card not found on this board." };
  const parsed = parseForm(commentSchema, formData);
  if ("error" in parsed) return { error: parsed.error };
  const assignee = card.assigneeId
    ? await db.teamMember.findUnique({ where: { id: card.assigneeId }, select: { name: true } }) : null;
  const r = await commentWithMentions({
    issueId, body: parsed.data.body, authorId: card.assigneeId, authorName: assignee?.name ?? "Developer", role: "developer",
  });
  revalidatePath(`/b/${boardShareId}`);
  return r;
}

export async function developerImage(formData: FormData): Promise<ActionResult> {
  const boardShareId = String(formData.get("boardShareId") ?? "");
  const issueId = String(formData.get("issueId") ?? "");
  const board = await boardFor(boardShareId);
  if (!board) return { error: "This link is no longer valid." };
  const card = await cardIn(board.id, issueId);
  if (!card) return { error: "Card not found on this board." };
  const file = formData.get("image");
  if (!(file instanceof File) || !file.size) return { error: "Choose an image." };
  const r = await storeImage(issueId, file);
  if (r.error) return r;
  revalidatePath(`/b/${boardShareId}`);
  return { ok: true };
}

/** Choose the cover from the link. Same one-at-a-time write as QA's. */
export async function developerCover(input: { boardShareId: string; issueId: string; imageId: string | null }): Promise<ActionResult> {
  const board = await boardFor(input.boardShareId);
  if (!board) return { error: "This link is no longer valid." };
  const card = await cardIn(board.id, input.issueId);
  if (!card) return { error: "Card not found on this board." };
  const r = await setCoverImage(input.issueId, input.imageId);
  revalidatePath(`/b/${input.boardShareId}`);
  return r;
}

/** Remove an attachment from the link. Same scoping as every developer write. */
export async function developerDeleteImage(input: { boardShareId: string; issueId: string; imageId: string }): Promise<ActionResult> {
  const board = await boardFor(input.boardShareId);
  if (!board) return { error: "This link is no longer valid." };
  const card = await cardIn(board.id, input.issueId);
  if (!card) return { error: "Card not found on this board." };
  const r = await removeImage(input.issueId, input.imageId);
  revalidatePath(`/b/${input.boardShareId}`);
  return r;
}
