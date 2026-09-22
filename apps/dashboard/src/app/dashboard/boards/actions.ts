"use server";

import { revalidatePath } from "next/cache";
import { randomBytes } from "node:crypto";
import { db } from "@/lib/db";
import { getActor } from "@/lib/auth";
import { type Actor, type Capability, can } from "@/lib/permissions";
import { headers } from "next/headers";
import { boardCardPatchSchema, boardCardSchema, boardDatesSchema, boardStageSchema, commentSchema, parseForm, type ActionResult } from "@/lib/validation";
import { conversationMembers, mentionMessage, parseMentions, participantsFor, plainText, moveReasonBody } from "@/lib/board-thread";
import { notifySlack } from "@/lib/slack";
import { canMove, isStage, moveNeedsReason, nextOrder, reorder } from "@/lib/boards";
import { BOARD_STAGE_LABELS, type BoardStage } from "@/lib/constants";

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
export async function createCard(formData: FormData): Promise<ActionResult & { id?: string }> {
  const actor = await guard("issue:write");
  if (!actor) return CANNOT_EDIT;
  const projectId = String(formData.get("projectId") ?? "");
  const pageId = String(formData.get("pageId") ?? "");
  if (!projectId || !pageId) return { error: "Choose the page this issue is on." };
  const parsed = parseForm(boardCardSchema, formData);
  if ("error" in parsed) return { error: parsed.error };

  const page = await db.page.findFirst({ where: { id: pageId, projectId }, select: { id: true } });
  if (!page) return { error: "That page is not in this project." };

  // An optional screenshot, checked BEFORE the card exists so a bad file
  // never leaves a card behind without the image the reporter meant to attach.
  const upload = formData.get("image");
  const file = upload instanceof File && upload.size > 0 ? upload : null;
  if (file) {
    const bad = checkImage(file);
    if (bad) return { error: bad };
  }

  const siblings = await db.issue.findMany({
    where: { page: { projectId }, boardStage: { not: null } },
    select: { boardStage: true, boardOrder: true },
  });
  let issueId: string;
  try {
    issueId = await db.$transaction(async (tx) => {
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
      return issue.id;
    });
  } catch {
    return { error: "Could not create the card." };
  }
  if (file) {
    // The first screenshot is the cover: it is what the issue looks like.
    const r = await storeImage(issueId, file, { cover: true });
    if (r.error) { revalidatePath(boardPath(projectId)); return { error: `Card added, but the screenshot failed: ${r.error}` }; }
  }
  revalidatePath(boardPath(projectId));
  return { ok: true, id: issueId };
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
  id: string; to: BoardStage; index: number; reason?: string;
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

  // Enforced here, not only in the dialog that asks for it: a server action is
  // POST-able directly, and a stage whose reason is optional is a stage that
  // ends up with no reasons.
  // The reason is written as a COMMENT, in the same transaction as the move.
  //
  // It could have been a column on IssueEvent, which would tie it to the
  // transition more tightly — but that costs a migration, and a comment is
  // already everything this needs: visible the moment the card opens, on the
  // developer view as well as QA's (which hides bare stage changes), attributed,
  // timestamped, and repliable. The lead-in makes it stand on its own in the
  // thread, since the developer view will not show the move line beside it.
  const reason = (input.reason ?? "").trim();
  if (moveNeedsReason(input.to, from) && !reason) {
    return { error: `Say why this is going to ${BOARD_STAGE_LABELS[input.to]}.` };
  }

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
      ...(reason
        ? [db.issueComment.create({
            data: {
              issueId: input.id,
              body: moveReasonBody(BOARD_STAGE_LABELS[input.to], reason),
              authorId: memberId(actor),
            },
          })]
        : []),
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

/** Does the card already have a cover? The first image becomes it, like the
 *  reference; after that the cover is whatever was chosen. */
export async function hasCover(issueId: string): Promise<boolean> {
  return (await db.issueImage.count({ where: { issueId, isCover: true } })) > 0;
}

/** The one rule for uploads, as a message or null. */
function checkImage(file: File): string | null {
  if (!IMAGE_TYPES.has(file.type)) return "PNG, JPEG, WebP or GIF only.";
  if (file.size > MAX_IMAGE_BYTES) return "Images are capped at 4 MB.";
  return null;
}

/** Shared by both sides: the bytes go in the same table either way. With
 *  `cover`, the new image becomes the card's cover in the same transaction. */
export type ImageResult = ActionResult & { id?: string; filename?: string | null };

export async function storeImage(issueId: string, file: File, opts: { cover?: boolean } = {}): Promise<ImageResult> {
  const bad = checkImage(file);
  if (bad) return { error: bad };
  const buf = Buffer.from(await file.arrayBuffer());
  const data = { issueId, contentType: file.type, image: buf, bytes: buf.length, filename: file.name.slice(0, 200) || null };
  let row: { id: string };
  if (opts.cover) {
    [, row] = await db.$transaction([
      db.issueImage.updateMany({ where: { issueId, isCover: true }, data: { isCover: false } }),
      db.issueImage.create({ data: { ...data, isCover: true }, select: { id: true } }),
    ]);
  } else {
    row = await db.issueImage.create({ data, select: { id: true } });
  }
  return { ok: true, id: row.id, filename: data.filename };
}

export async function addImage(formData: FormData): Promise<ImageResult> {
  if (!(await guard("issue:write"))) return CANNOT_EDIT;
  const issueId = String(formData.get("issueId") ?? "");
  const file = formData.get("image");
  if (!(file instanceof File) || !file.size) return { error: "Choose an image." };
  const projectId = await projectOf(issueId);
  if (!projectId) return { error: "Card not found." };
  const r = await storeImage(issueId, file, { cover: !(await hasCover(issueId)) });
  if (r.error) return r;
  revalidatePath(boardPath(projectId));
  return r;
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

/** Remember that this person has now seen this card. Called when a card is
 *  opened; unread is derived from it, so there is nothing to "mark read". */
export async function markCardViewed(input: { issueId: string }): Promise<ActionResult> {
  const actor = await getActor();
  // The shared login is nobody in particular and has no row to hang a view on.
  if (!actor || actor.bootstrap) return { ok: true };
  await db.issueView.upsert({
    where: { issueId_viewerId: { issueId: input.issueId, viewerId: actor.id } },
    create: { issueId: input.issueId, viewerId: actor.id, viewedAt: new Date() },
    update: { viewedAt: new Date() },
  });
  return { ok: true };
}

/** The board's accent. Null puts it back to the app's default purple. */
export async function setAccent(input: { projectId: string; color: string | null }): Promise<ActionResult> {
  if (!(await guard("client:edit"))) return { error: "Your access level cannot change this board." };
  const color = input.color?.trim() ?? null;
  if (color && !/^#[0-9a-fA-F]{6}$/.test(color)) return { error: "Use a six-digit hex colour." };
  await db.project.update({ where: { id: input.projectId }, data: { accentColor: color } });
  revalidatePath(boardPath(input.projectId));
  return { ok: true };
}

/** Start, due and reminder from the Dates popover. Changing the due date
 *  re-arms the reminder: dueRemindedAt is cleared so the sweep sends again. */
export async function setDates(input: { id: string; startAt: string | null; dueAt: string | null; dueReminderMinutes: number | null }): Promise<ActionResult> {
  if (!(await guard("issue:write"))) return CANNOT_EDIT;
  const parsed = boardDatesSchema.safeParse(input);
  if (!parsed.success) return { error: "Those dates do not make sense." };
  const { startAt, dueAt, dueReminderMinutes } = parsed.data;
  if (startAt && dueAt && new Date(startAt) > new Date(dueAt)) return { error: "The start date is after the due date." };
  const projectId = await projectOf(input.id);
  if (!projectId) return { error: "Card not found." };
  const current = await db.issue.findUnique({ where: { id: input.id }, select: { dueAt: true } });
  const dueChanged = (current?.dueAt?.toISOString() ?? null) !== (dueAt ? new Date(dueAt).toISOString() : null);
  await db.issue.update({
    where: { id: input.id },
    data: {
      startAt: startAt ? new Date(startAt) : null,
      dueAt: dueAt ? new Date(dueAt) : null,
      dueReminderMinutes: dueAt ? dueReminderMinutes : null,
      ...(dueChanged ? { dueRemindedAt: null } : {}),
    },
  });
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

/** Delete a comment. QA may delete any comment on a card in the project; the
 *  developer side deletes only its own (see developerDeleteComment). The
 *  mention rows go with it (cascade); a Slack ping already sent stays sent. */
export async function deleteComment(input: { id: string }): Promise<ActionResult> {
  if (!(await guard("issue:write"))) return CANNOT_EDIT;
  const c = await db.issueComment.findUnique({ where: { id: input.id }, select: { issueId: true } });
  if (!c) return { error: "Comment not found." };
  const projectId = await projectOf(c.issueId);
  if (!projectId) return { error: "Card not found." };
  await db.issueComment.delete({ where: { id: input.id } });
  revalidatePath(boardPath(projectId));
  return { ok: true };
}

/** Remove an attachment. Shared with the developer side, which scopes it. */
export async function removeImage(issueId: string, imageId: string): Promise<ActionResult> {
  const r = await db.issueImage.deleteMany({ where: { id: imageId, issueId } });
  return r.count ? { ok: true } : { error: "That image is not on this card." };
}

export async function deleteImage(input: { issueId: string; imageId: string }): Promise<ActionResult> {
  if (!(await guard("issue:write"))) return CANNOT_EDIT;
  const projectId = await projectOf(input.issueId);
  if (!projectId) return { error: "Card not found." };
  const r = await removeImage(input.issueId, input.imageId);
  revalidatePath(boardPath(projectId));
  return r;
}

export async function setCover(input: { issueId: string; imageId: string | null }): Promise<ActionResult> {
  if (!(await guard("issue:write"))) return CANNOT_EDIT;
  const projectId = await projectOf(input.issueId);
  if (!projectId) return { error: "Card not found." };
  const r = await setCoverImage(input.issueId, input.imageId);
  revalidatePath(boardPath(projectId));
  return r;
}

/** `notes` carries anything the sender should know: who could not be reached
 *  and why, and also a delivery that only half-worked — a DM that failed and
 *  fell back to the webhook channel is reported, not passed off as a ping. */
export type CommentResult = ActionResult & { mentioned?: number; notified?: number; notes?: string[] };

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
      images: { where: { isCover: true }, select: { id: true }, take: 1 },
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
  // A reply: everyone already talking on this card hears it, tagged or not.
  const prior = await db.issueComment.findMany({
    where: { issueId: input.issueId }, select: { authorId: true, mentions: { select: { memberId: true } } },
  });
  const replyTo = conversationMembers(prior.map((c) => ({ authorId: c.authorId, mentionedIds: c.mentions.map((m) => m.memberId) })), input.authorId)
    .filter((id) => !mentioned.includes(id));

  const comment = await db.$transaction(async (tx) => {
    const c = await tx.issueComment.create({ data: { issueId: input.issueId, body: input.body, authorId: input.authorId } });
    if (mentioned.length) {
      await tx.issueMention.createMany({ data: mentioned.map((memberId) => ({ commentId: c.id, memberId })) });
    }
    return c;
  });
  const recipients = [...mentioned, ...replyTo];
  if (!recipients.length) return { ok: true, mentioned: 0, notified: 0 };

  const members = await db.teamMember.findMany({
    where: { id: { in: recipients } }, select: { id: true, name: true, slackUserId: true, role: true },
  });
  const h = await headers();
  const origin = `${h.get("x-forwarded-proto") ?? "https"}://${h.get("host") ?? ""}`;
  const project = issue.page.project;
  // Slack fetches an accessory image from its own servers, with no session, so
  // the only reachable form is the board's capability link — which the
  // recipients of these messages already hold. No cover or no minted link
  // means no accessory at all.
  const cover = issue.images[0];
  const coverUrl = cover && project.boardShareId
    ? `${origin}/api/board-image?id=${cover.id}&share=${project.boardShareId}`
    : null;
  const notes: string[] = [];
  let notified = 0;
  for (const m of members) {
    if (!m.slackUserId) { notes.push(`${m.name} has no Slack id`); continue; }
    // A developer opens the card through the board link; QA through the app.
    const url = m.role === "DEVELOPER" && project.boardShareId
      ? `${origin}/b/${project.boardShareId}` : `${origin}/dashboard/boards/${project.id}`;
    const isMention = mentioned.includes(m.id);
    // input.authorName is the person's REAL name, on purpose, even when the
    // recipient sees them as "QA" on the card — see board-thread.ts.
    const r = await notifySlack(m.slackUserId, mentionMessage({
      kind: isMention ? "mention" : "reply",
      slackUserId: m.slackUserId,
      byName: input.authorName,
      cardTitle: issue.title,
      boardName: project.name,
      body: plainText(input.body),
      url,
      coverUrl,
    }));
    if (r.sent) {
      notified++;
      if (r.reason) notes.push(`${m.name}: ${r.reason}`); // reached, but not the way we meant to
      if (isMention) await db.issueMention.updateMany({ where: { commentId: comment.id, memberId: m.id }, data: { notifiedAt: new Date() } });
    } else {
      notes.push(`${m.name}: ${r.reason}`);
    }
  }
  return { ok: true, mentioned: recipients.length, notified, notes: notes.length ? notes : undefined };
}

// --- Archiving --------------------------------------------------------------
//
// Archiving is a FLAG. Nothing cascades, nothing is deleted, nothing moves:
// the cards, the comments, the screenshots, the event log, the assignees and
// the developer link all stay exactly where they are. The board still opens
// and still works — it is simply out of the grid. Unarchiving clears one
// column.
//
// The developer link is deliberately NOT revoked. Archiving is a tidying
// action, and silently breaking a URL somebody was given is not tidying. The
// archive page shows which archived boards still have a live link so it stays
// a visible decision rather than a forgotten one.

export async function archiveBoard(input: { projectId: string }): Promise<ActionResult> {
  const actor = await guard("issue:write");
  if (!actor) return { error: "Your access level cannot archive boards." };
  const project = await db.project.findUnique({
    where: { id: input.projectId },
    select: { boardArchivedAt: true },
  });
  if (!project) return { error: "Project not found." };
  if (project.boardArchivedAt) return { ok: true }; // already away; not an error

  await db.project.update({
    where: { id: input.projectId },
    data: { boardArchivedAt: new Date(), boardArchivedById: memberId(actor) },
  });
  revalidatePath("/dashboard/boards");
  revalidatePath("/dashboard/boards/archive");
  revalidatePath(boardPath(input.projectId));
  return { ok: true };
}

export async function unarchiveBoard(input: { projectId: string }): Promise<ActionResult> {
  if (!(await guard("issue:write"))) return { error: "Your access level cannot archive boards." };
  await db.project.update({
    where: { id: input.projectId },
    data: { boardArchivedAt: null, boardArchivedById: null },
  });
  revalidatePath("/dashboard/boards");
  revalidatePath("/dashboard/boards/archive");
  revalidatePath(boardPath(input.projectId));
  return { ok: true };
}
