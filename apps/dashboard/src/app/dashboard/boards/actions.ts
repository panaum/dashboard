"use server";

import { revalidatePath } from "next/cache";
import { randomBytes } from "node:crypto";
import { db } from "@/lib/db";
import { getActor } from "@/lib/auth";
import { type Actor, type Capability, can } from "@/lib/permissions";
import { headers } from "next/headers";
import { boardCardPatchSchema, boardCardSchema, boardStageSchema, commentSchema, parseForm, type ActionResult } from "@/lib/validation";
import { parseMentions, participantsFor, slackMentionText } from "@/lib/board-thread";
import { postSlack } from "@/lib/slack";
import { canMove, isStage, nextOrder, reorder } from "@/lib/boards";
import type { BoardStage } from "@/lib/constants";

// QA's side of the board. Every write here happens inside the app shell,
// behind the session, and is attributed to the signed-in member: reporterId on
// the card, actorId on every stage change, authorId on every comment. The
// shared team-password session has no TeamMember behind it, so it records as
// null — the one write that stays unattributable, and the reason to sign in
// as yourself before touching a board.

const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

const boardPath = (projectId: string) => `/dashboard/boards/${projectId}`;

/** Same shape as the team actions: an error the form can show, not a redirect. */
async function guard(capability: Capability): Promise<Actor | null> {
  const actor = await getActor();
  return can(actor, capability) ? actor! : null;
}

/** The id to write into an attribution column. The bootstrap session has no
 *  row to point at, and a foreign key to nowhere is worse than null. */
const memberId = (actor: Actor) => (actor.bootstrap ? null : actor.id);

const CANNOT_EDIT = { error: "Your access level cannot edit boards." };

async function projectOf(issueId: string): Promise<string | null> {
  const row = await db.issue.findUnique({
    where: { id: issueId }, select: { page: { select: { projectId: true } } },
  });
  return row?.page.projectId ?? null;
}

/** Create a card straight onto a project's board, or promote an existing
 *  page issue onto it. Creation is itself the first IssueEvent. */
export async function createCard(formData: FormData): Promise<ActionResult> {
  const actor = await guard("issue:write");
  if (!actor) return CANNOT_EDIT;
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
          reporterId: memberId(actor),
          boardStage: "NEW",
          boardOrder: nextOrder(siblings, "NEW"),
        },
      });
      await tx.issueEvent.create({ data: { issueId: issue.id, fromStage: null, toStage: "NEW", actorId: memberId(actor) } });
    });
  } catch {
    return { error: "Could not create the card." };
  }
  revalidatePath(boardPath(projectId));
  return { ok: true };
}

export async function updateCard(formData: FormData): Promise<ActionResult> {
  if (!(await guard("issue:write"))) return CANNOT_EDIT;
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
  const actor = await guard("issue:write");
  if (!actor) return CANNOT_EDIT;
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
        data: { issueId: input.id, fromStage: from, toStage: input.to, actorId: memberId(actor) },
      })]),
    ]);
  } catch {
    return { error: "Could not move the card." };
  }
  revalidatePath(boardPath(issue.page.projectId));
  return { ok: true };
}

export async function deleteCard(input: { id: string }): Promise<ActionResult> {
  if (!(await guard("issue:write"))) return CANNOT_EDIT;
  const projectId = await projectOf(input.id);
  if (!projectId) return { error: "Card not found." };
  await db.issue.delete({ where: { id: input.id } });
  revalidatePath(boardPath(projectId));
  return { ok: true };
}

export async function addComment(formData: FormData): Promise<ActionResult> {
  const actor = await guard("issue:write");
  if (!actor) return CANNOT_EDIT;
  const issueId = String(formData.get("issueId") ?? "");
  const parsed = parseForm(commentSchema, formData);
  if ("error" in parsed) return { error: parsed.error };
  const projectId = await projectOf(issueId);
  if (!projectId) return { error: "Card not found." };
  const r = await commentWithMentions({
    issueId, body: parsed.data.body, authorId: memberId(actor), authorName: actor.name, role: "qa",
  });
  revalidatePath(boardPath(projectId));
  return r;
}

/** Shared by both sides: the bytes go in the same table either way. */
export async function storeImage(issueId: string, file: File): Promise<ActionResult> {
  if (!IMAGE_TYPES.has(file.type)) return { error: "PNG, JPEG, WebP or GIF only." };
  if (file.size > MAX_IMAGE_BYTES) return { error: "Images are capped at 4 MB." };
  const buf = Buffer.from(await file.arrayBuffer());
  await db.issueImage.create({
    data: { issueId, contentType: file.type, image: buf, bytes: buf.length, filename: file.name.slice(0, 200) || null },
  });
  return { ok: true };
}

export async function addImage(formData: FormData): Promise<ActionResult> {
  if (!(await guard("issue:write"))) return CANNOT_EDIT;
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
  const actor = await guard("sharelink:mint");
  if (!actor) return { error: "Your access level cannot share boards." };
  const existing = await db.project.findUnique({ where: { id: input.projectId }, select: { boardShareId: true } });
  if (!existing) return { error: "Project not found." };
  let boardShareId = existing.boardShareId ?? null;
  if (!boardShareId) {
    boardShareId = randomBytes(12).toString("base64url");
    // The token and its attribution are one write: a link that exists
    // without a minter is exactly the state this column removes.
    await db.project.update({
      where: { id: input.projectId },
      data: { boardShareId, boardShareCreatedById: memberId(actor), boardShareCreatedAt: new Date() },
    });
  }
  revalidatePath(boardPath(input.projectId));
  return { ok: true, boardShareId };
}

export async function revokeBoardLink(input: { projectId: string }): Promise<ActionResult> {
  if (!(await guard("sharelink:mint"))) return { error: "Your access level cannot share boards." };
  await db.project.update({
    where: { id: input.projectId },
    data: { boardShareId: null, boardShareCreatedById: null, boardShareCreatedAt: null },
  });
  revalidatePath(boardPath(input.projectId));
  return { ok: true };
}

// --- The card modal: inline edits, the cover, the thread ---------------------

/** Title or description edited in place. Only the keys sent are written. */
export async function patchCard(formData: FormData): Promise<ActionResult> {
  if (!(await guard("issue:write"))) return CANNOT_EDIT;
  const id = String(formData.get("id") ?? "");
  const parsed = parseForm(boardCardPatchSchema, formData);
  if ("error" in parsed) return { error: parsed.error };
  const projectId = await projectOf(id);
  if (!projectId) return { error: "Card not found." };
  const data: { title?: string; description?: string | null } = {};
  if (formData.has("title") && parsed.data.title !== undefined) data.title = parsed.data.title;
  if (formData.has("description")) data.description = parsed.data.description || null;
  if (!Object.keys(data).length) return { ok: true };
  await db.issue.update({ where: { id }, data });
  revalidatePath(boardPath(projectId));
  return { ok: true };
}

/** Flag one image as the card's cover, clearing the previous one in the same
 *  transaction — one cover at a time is a rule, not a hope. Shared with the
 *  developer side, which checks the board token before calling it. */
export async function setCoverImage(issueId: string, imageId: string | null): Promise<ActionResult> {
  const img = imageId
    ? await db.issueImage.findFirst({ where: { id: imageId, issueId }, select: { id: true } })
    : null;
  if (imageId && !img) return { error: "That image is not on this card." };
  await db.$transaction([
    db.issueImage.updateMany({ where: { issueId, isCover: true }, data: { isCover: false } }),
    ...(img ? [db.issueImage.update({ where: { id: img.id }, data: { isCover: true } })] : []),
  ]);
  return { ok: true };
}

export async function setCover(input: { issueId: string; imageId: string | null }): Promise<ActionResult> {
  if (!(await guard("issue:write"))) return CANNOT_EDIT;
  const projectId = await projectOf(input.issueId);
  if (!projectId) return { error: "Card not found." };
  const r = await setCoverImage(input.issueId, input.imageId);
  revalidatePath(boardPath(projectId));
  return r;
}

export type CommentResult = ActionResult & { mentioned?: number; notified?: number; unnotified?: string[] };

/**
 * Write a comment and the structured mention rows in one transaction, then
 * ping each mentioned person on Slack. Both sides of the board call this; the
 * role decides who may be mentioned (participantsFor) and what they are
 * called. Delivery is recorded per mention (notifiedAt) — an unset webhook or
 * a failed POST comes back in the result, it does not pass as success.
 */
export async function commentWithMentions(input: {
  issueId: string; body: string; authorId: string | null; authorName: string; role: "qa" | "developer";
}): Promise<CommentResult> {
  const issue = await db.issue.findUnique({
    where: { id: input.issueId },
    select: {
      title: true, reporterId: true, assigneeId: true,
      reporter: { select: { name: true } }, assignee: { select: { name: true } },
      page: { select: { project: { select: { id: true, name: true, boardShareId: true } } } },
    },
  });
  if (!issue) return { error: "Card not found." };
  const participants = participantsFor(input.role, {
    reporterId: issue.reporterId, reporterName: issue.reporter?.name ?? null,
    assigneeId: issue.assigneeId, assigneeName: issue.assignee?.name ?? null,
  });
  // Never ping yourself; the row would be noise.
  const mentioned = parseMentions(input.body, participants).filter((id) => id !== input.authorId);

  const comment = await db.$transaction(async (tx) => {
    const c = await tx.issueComment.create({ data: { issueId: input.issueId, body: input.body, authorId: input.authorId } });
    if (mentioned.length) {
      await tx.issueMention.createMany({ data: mentioned.map((memberId) => ({ commentId: c.id, memberId })) });
    }
    return c;
  });
  if (!mentioned.length) return { ok: true, mentioned: 0, notified: 0 };

  const members = await db.teamMember.findMany({
    where: { id: { in: mentioned } }, select: { id: true, name: true, slackUserId: true, role: true },
  });
  const h = await headers();
  const origin = `${h.get("x-forwarded-proto") ?? "https"}://${h.get("host") ?? ""}`;
  const project = issue.page.project;
  const unnotified: string[] = [];
  let notified = 0;
  for (const m of members) {
    if (!m.slackUserId) { unnotified.push(`${m.name} has no Slack id`); continue; }
    // A developer opens the card through the board link; QA through the app.
    const url = m.role === "DEVELOPER" && project.boardShareId
      ? `${origin}/b/${project.boardShareId}` : `${origin}/dashboard/boards/${project.id}`;
    const r = await postSlack(slackMentionText({
      slackUserId: m.slackUserId, byName: input.authorName, cardTitle: issue.title, boardName: project.name, body: input.body, url,
    }));
    if (r.sent) {
      notified++;
      await db.issueMention.updateMany({ where: { commentId: comment.id, memberId: m.id }, data: { notifiedAt: new Date() } });
    } else {
      unnotified.push(`${m.name}: ${r.reason}`);
    }
  }
  return { ok: true, mentioned: mentioned.length, notified, unnotified: unnotified.length ? unnotified : undefined };
}
