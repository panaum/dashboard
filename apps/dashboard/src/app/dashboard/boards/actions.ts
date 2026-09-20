"use server";

import { revalidatePath } from "next/cache";
import { randomBytes } from "node:crypto";
import { db } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { boardCardSchema, boardStageSchema, commentSchema, parseForm, type ActionResult } from "@/lib/validation";
import { canMove, isStage, nextOrder, reorder } from "@/lib/boards";
import type { BoardStage } from "@/lib/constants";

// QA's side of the board. Every write here happens inside the app shell,
// behind the session — today a single shared one, so reporterId and the QA
// actorId stay null rather than pretend to be somebody. When per-person
// sessions land, these become the member's id and nothing else changes.

const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

const boardPath = (projectId: string) => `/dashboard/boards/${projectId}`;

async function projectOf(issueId: string): Promise<string | null> {
  const row = await db.issue.findUnique({
    where: { id: issueId }, select: { page: { select: { projectId: true } } },
  });
  return row?.page.projectId ?? null;
}

/** Create a card straight onto a project's board, or promote an existing
 *  page issue onto it. Creation is itself the first IssueEvent. */
export async function createCard(formData: FormData): Promise<ActionResult> {
  await requireAuth();
  const projectId = String(formData.get("projectId") ?? "");
  const pageId = String(formData.get("pageId") ?? "");
  if (!projectId || !pageId) return { error: "Choose the page this issue is on." };
  const parsed = parseForm(boardCardSchema, formData);
  if ("error" in parsed) return { error: parsed.error };

  const page = await db.page.findFirst({ where: { id: pageId, projectId }, select: { id: true } });
  if (!page) return { error: "That page is not in this project." };

  const siblings = await db.issue.findMany({
    where: { page: { projectId }, boardStage: { not: null } },
    select: { boardStage: true, boardOrder: true },
  });
  try {
    await db.$transaction(async (tx) => {
      const issue = await tx.issue.create({
        data: {
          ...parsed.data,
          pageId,
          boardStage: "NEW",
          boardOrder: nextOrder(siblings, "NEW"),
        },
      });
      await tx.issueEvent.create({ data: { issueId: issue.id, fromStage: null, toStage: "NEW", actorId: null } });
    });
  } catch {
    return { error: "Could not create the card." };
  }
  revalidatePath(boardPath(projectId));
  return { ok: true };
}

export async function updateCard(formData: FormData): Promise<ActionResult> {
  await requireAuth();
  const id = String(formData.get("id") ?? "");
  const parsed = parseForm(boardCardSchema, formData);
  if ("error" in parsed) return { error: parsed.error };
  const projectId = await projectOf(id);
  if (!projectId) return { error: "Card not found." };
  try {
    await db.issue.update({ where: { id }, data: parsed.data });
  } catch {
    return { error: "Could not save the card." };
  }
  revalidatePath(boardPath(projectId));
  return { ok: true };
}

/**
 * Move a card to a stage at a position. One transaction: the stage change,
 * the dense re-order of the destination stage, and the event that every
 * metric is computed from. A move that the rules refuse never reaches the DB.
 */
export async function moveCard(input: {
  id: string; to: BoardStage; index: number;
}): Promise<ActionResult> {
  await requireAuth();
  if (!isStage(input.to)) return { error: "Unknown stage." };
  const issue = await db.issue.findUnique({
    where: { id: input.id }, select: { boardStage: true, page: { select: { projectId: true } } },
  });
  if (!issue) return { error: "Card not found." };
  const from = isStage(issue.boardStage) ? issue.boardStage : null;
  const sameStage = from === input.to;
  if (!sameStage && !canMove("qa", from, input.to)) return { error: "That move is not allowed." };

  const cards = await db.issue.findMany({
    where: { page: { projectId: issue.page.projectId }, boardStage: { not: null } },
    select: { id: true, boardStage: true, boardOrder: true },
  });
  const writes = reorder(cards, input.to, input.id, input.index);
  try {
    await db.$transaction([
      ...writes.map((w) => db.issue.update({
        where: { id: w.id },
        data: w.id === input.id ? { boardStage: input.to, boardOrder: w.boardOrder } : { boardOrder: w.boardOrder },
      })),
      ...(sameStage ? [] : [db.issueEvent.create({
        data: { issueId: input.id, fromStage: from, toStage: input.to, actorId: null },
      })]),
    ]);
  } catch {
    return { error: "Could not move the card." };
  }
  revalidatePath(boardPath(issue.page.projectId));
  return { ok: true };
}

export async function deleteCard(input: { id: string }): Promise<ActionResult> {
  await requireAuth();
  const projectId = await projectOf(input.id);
  if (!projectId) return { error: "Card not found." };
  await db.issue.delete({ where: { id: input.id } });
  revalidatePath(boardPath(projectId));
  return { ok: true };
}

export async function addComment(formData: FormData): Promise<ActionResult> {
  await requireAuth();
  const issueId = String(formData.get("issueId") ?? "");
  const parsed = parseForm(commentSchema, formData);
  if ("error" in parsed) return { error: parsed.error };
  const projectId = await projectOf(issueId);
  if (!projectId) return { error: "Card not found." };
  await db.issueComment.create({ data: { issueId, body: parsed.data.body, authorId: null } });
  revalidatePath(boardPath(projectId));
  return { ok: true };
}

/** Shared by both sides: the bytes go in the same table either way. */
export async function storeImage(issueId: string, file: File): Promise<ActionResult> {
  if (!IMAGE_TYPES.has(file.type)) return { error: "PNG, JPEG, WebP or GIF only." };
  if (file.size > MAX_IMAGE_BYTES) return { error: "Images are capped at 4 MB." };
  const buf = Buffer.from(await file.arrayBuffer());
  await db.issueImage.create({
    data: { issueId, contentType: file.type, image: buf, bytes: buf.length },
  });
  return { ok: true };
}

export async function addImage(formData: FormData): Promise<ActionResult> {
  await requireAuth();
  const issueId = String(formData.get("issueId") ?? "");
  const file = formData.get("image");
  if (!(file instanceof File) || !file.size) return { error: "Choose an image." };
  const projectId = await projectOf(issueId);
  if (!projectId) return { error: "Card not found." };
  const r = await storeImage(issueId, file);
  if (r.error) return r;
  revalidatePath(boardPath(projectId));
  return { ok: true };
}

// --- The developer link: Page.shareId's mechanism, on the project -----------

export async function mintBoardLink(input: { projectId: string }): Promise<ActionResult & { boardShareId?: string }> {
  await requireAuth();
  const existing = await db.project.findUnique({ where: { id: input.projectId }, select: { boardShareId: true } });
  if (!existing) return { error: "Project not found." };
  let boardShareId = existing.boardShareId ?? null;
  if (!boardShareId) {
    boardShareId = randomBytes(12).toString("base64url");
    await db.project.update({ where: { id: input.projectId }, data: { boardShareId } });
  }
  revalidatePath(boardPath(input.projectId));
  return { ok: true, boardShareId };
}

export async function revokeBoardLink(input: { projectId: string }): Promise<ActionResult> {
  await requireAuth();
  await db.project.update({ where: { id: input.projectId }, data: { boardShareId: null } });
  revalidatePath(boardPath(input.projectId));
  return { ok: true };
}
