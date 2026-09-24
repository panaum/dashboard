import "server-only";
import { headers } from "next/headers";
import { db } from "@/lib/db";
import { conversationMembers, mentionMessage, parseMentions, participantsFor, plainText } from "@/lib/board-thread";
import { notifySlack } from "@/lib/slack";
import type { ActionResult } from "@/lib/validation";

// Board writes shared by both sides of the board: QA's (app session, in
// dashboard/boards/actions.ts) and the developer's (board token, in
// b/[boardShareId]/actions.ts). They check NOTHING themselves — each caller
// authorises first. That is why they live here and not in a "use server"
// file: every export of one of those is a public endpoint, and these take the
// author's id and name straight from their arguments.

const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

/** Does the card already have a cover? The first image becomes it, like the
 *  reference; after that the cover is whatever was chosen. */
export async function hasCover(issueId: string): Promise<boolean> {
  return (await db.issueImage.count({ where: { issueId, isCover: true } })) > 0;
}

/** The one rule for uploads, as a message or null. */
export function checkImage(file: File): string | null {
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

/** Remove an attachment. Shared with the developer side, which scopes it. */
export async function removeImage(issueId: string, imageId: string): Promise<ActionResult> {
  const r = await db.issueImage.deleteMany({ where: { id: imageId, issueId } });
  return r.count ? { ok: true } : { error: "That image is not on this card." };
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
