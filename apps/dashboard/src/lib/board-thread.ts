// BOARD THREAD — the card's conversation and activity, as pure functions.
//
// No I/O, no Prisma, no React. Everything the modal shows below the
// description is derived here from rows the pages already fetch: who may be
// @mentioned, which ids a body mentions, how comments and stage events
// interleave, which image is the cover, and what a Slack ping says.

import { BOARD_STAGE_LABELS, type BoardStage } from "./constants";
import type { Role } from "./boards";

export type Participant = { id: string; label: string };

/**
 * Who a comment on this card may @mention. The spec scopes it to the card's
 * two people — reporter and assignee — never the whole team.
 *
 * The developer view names the reporter "QA": the label is what appears in
 * the composer and the body, and the reporter's name must not leave the
 * server for that view. The id still resolves, so the ping reaches them.
 */
export function participantsFor(
  role: Role,
  card: {
    reporterId: string | null; reporterName: string | null;
    assigneeId: string | null; assigneeName: string | null;
  },
): Participant[] {
  const out: Participant[] = [];
  if (role === "qa") {
    if (card.assigneeId) out.push({ id: card.assigneeId, label: card.assigneeName ?? "Developer" });
    if (card.reporterId && card.reporterId !== card.assigneeId) {
      out.push({ id: card.reporterId, label: card.reporterName ?? "Reporter" });
    }
  } else if (card.reporterId) {
    out.push({ id: card.reporterId, label: "QA" });
  }
  return out;
}

/**
 * The participant ids a body mentions, in order of first appearance. A match
 * is "@" + the participant's label, case-insensitive, ending at a word
 * boundary — so "@Priya" does not match "@Priyanka" when both are on the
 * card, and longer labels are tried first so "@Priya Sharma" wins over
 * "@Priya". Anything else that looks like a mention is just text: only the
 * card's participants can be pinged, whatever the client sends.
 */
export function parseMentions(body: string, participants: Participant[]): string[] {
  const lower = body.toLowerCase();
  const hits: { id: string; at: number }[] = [];
  const byLength = [...participants].sort((a, b) => b.label.length - a.label.length);
  const taken: [number, number][] = [];
  for (const p of byLength) {
    const needle = `@${p.label.toLowerCase()}`;
    let from = 0;
    for (;;) {
      const at = lower.indexOf(needle, from);
      if (at < 0) break;
      from = at + 1;
      const end = at + needle.length;
      const next = lower[end];
      const boundary = next === undefined || !/[\p{L}\p{N}_]/u.test(next);
      const overlaps = taken.some(([s, e]) => at < e && end > s);
      if (!boundary || overlaps) continue;
      taken.push([at, end]);
      if (!hits.some((h) => h.id === p.id)) hits.push({ id: p.id, at });
    }
  }
  return hits.sort((a, b) => a.at - b.at).map((h) => h.id);
}

/** The labels a viewer's composer offers after "@": the card's participants
 *  minus the viewer. The server still resolves whatever is typed against the
 *  full list and drops self-mentions; this only keeps your own name out of the
 *  menu. The shared session has no id on the card, so it sees everyone. */
export function mentionLabelsFor(role: Role, card: Parameters<typeof participantsFor>[1], viewerId: string | null): string[] {
  return participantsFor(role, card).filter((p) => p.id !== viewerId).map((p) => p.label);
}

export type FeedComment = {
  kind: "comment"; id: string; body: string; authorName: string | null; createdAt: string;
};
export type FeedEvent = {
  kind: "event"; id: string; text: string; actorName: string | null; createdAt: string;
};
export type FeedItem = FeedComment | FeedEvent;

/** "Priya moved this card from Active to Completed" — the system line for one
 *  stage change. Creation onto the board has no fromStage. */
export function eventLine(e: {
  actorName: string | null; fromStage: BoardStage | null; toStage: BoardStage;
}): string {
  const who = e.actorName ?? "Someone";
  if (!e.fromStage) return `${who} added this card to ${BOARD_STAGE_LABELS[e.toStage]}`;
  return `${who} moved this card from ${BOARD_STAGE_LABELS[e.fromStage]} to ${BOARD_STAGE_LABELS[e.toStage]}`;
}

/**
 * One feed: comments and stage events interleaved by time. No activity table
 * — IssueEvent already is one. Ties (same instant) put the event first, since
 * a comment written on a move follows the move.
 */
export function activityFeed(
  comments: { id: string; body: string; authorName: string | null; createdAt: string }[],
  events: { id: string; actorName: string | null; fromStage: BoardStage | null; toStage: BoardStage; createdAt: string }[],
): FeedItem[] {
  const items: FeedItem[] = [
    ...comments.map((c): FeedComment => ({ kind: "comment", id: c.id, body: c.body, authorName: c.authorName, createdAt: c.createdAt })),
    ...events.map((e): FeedEvent => ({ kind: "event", id: e.id, text: eventLine(e), actorName: e.actorName, createdAt: e.createdAt })),
  ];
  return items.sort((a, b) =>
    a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.kind === b.kind ? 0 : a.kind === "event" ? -1 : 1,
  );
}

/** The cover: the flagged image, largest first if more than one is flagged
 *  (a race between two uploads, not a state the UI can reach on purpose). */
export function coverOf<T extends { isCover: boolean; bytes: number }>(images: T[]): T | null {
  return images.filter((i) => i.isCover).sort((a, b) => b.bytes - a.bytes)[0] ?? null;
}

/** Up to two letters for the avatar: "Priya Sharma" → "PS", "Priya" → "P". */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  return (parts.length === 1 ? parts[0].slice(0, 1) : parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** "12 Sep, 3:04pm". Time zone is a parameter so the test is not tied to the
 *  machine; the modal passes the viewer's. */
export function formatWhen(iso: string, timeZone?: string): string {
  const d = new Date(iso);
  const part = (opts: Intl.DateTimeFormatOptions, type: string) =>
    new Intl.DateTimeFormat("en-US", { ...opts, timeZone }).formatToParts(d).find((p) => p.type === type)?.value ?? "";
  const day = part({ day: "numeric" }, "day");
  const month = part({ month: "short" }, "month"); // en-US: "Sep", not en-GB's "Sept"
  const time = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", hour12: true, timeZone })
    .format(d).replace(/\s?(AM|PM)/, (m) => m.trim().toLowerCase());
  return `${day} ${month}, ${time}`;
}

/** "28 Aug 2026, 00:15" — the stamp under a comment or attachment, as the
 *  reference writes it: day-first date with the year, 24-hour time. */
export function formatStamp(iso: string, timeZone?: string): string {
  const d = new Date(iso);
  const part = (opts: Intl.DateTimeFormatOptions, type: string) =>
    new Intl.DateTimeFormat("en-US", { ...opts, timeZone }).formatToParts(d).find((p) => p.type === type)?.value ?? "";
  const time = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone }).format(d);
  return `${part({ day: "numeric" }, "day")} ${part({ month: "short" }, "month")} ${part({ year: "numeric" }, "year")}, ${time}`;
}

/** Slack mrkdwn escaping: the three characters Slack reads as markup. */
export function escapeSlack(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** The ping. One line, the person's Slack handle first so it notifies, then
 *  who said what on which card, and a link. */
export function slackMentionText(input: {
  slackUserId: string; byName: string; cardTitle: string; boardName: string; body: string; url: string;
}): string {
  const excerpt = input.body.length > 140 ? `${input.body.slice(0, 139)}…` : input.body;
  return `<@${input.slackUserId}> *${escapeSlack(input.byName)}* mentioned you on *${escapeSlack(input.cardTitle)}* (${escapeSlack(input.boardName)}): "${escapeSlack(excerpt)}" — <${input.url}|Open card>`;
}


// ── comment markup ──────────────────────────────────────────────────────────
//
// A comment is plain text with a little markup, the subset of the reference's
// toolbar that a QA thread actually uses: **bold**, _italic_, ~~struck~~,
// `code`, "- " bullet lists, "1. " numbered lists, bare URLs, and an image
// attached from the composer as ![name](img:ID). Rendered by escaping the
// text FIRST and then adding tags of our own, so nothing typed can become
// markup. No dependency.

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function inline(text: string, imageSrc: (id: string) => string, mentions: string[]): string {
  let t = escapeHtml(text);
  t = t.replace(/!\[([^\]]*)\]\(img:([A-Za-z0-9_-]+)\)/g, (_m, name, id) =>
    `<a href="${imageSrc(id)}" target="_blank" rel="noopener" class="block"><img src="${imageSrc(id)}" alt="${name}" class="mt-1 max-h-48 rounded-md ring-1 ring-inset ring-border-soft" /></a>`);
  t = t.replace(/`([^`\n]+)`/g, '<code class="rounded bg-card-soft px-1 font-mono text-[12px]">$1</code>');
  t = t.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
  t = t.replace(/(^|[^\w])_([^_\n]+)_(?=$|[^\w])/g, "$1<em>$2</em>");
  t = t.replace(/~~([^~\n]+)~~/g, "<s>$1</s>");
  t = t.replace(/(https?:\/\/[^\s<]+[^\s<.,;:!?)"'])/g, '<a href="$1" target="_blank" rel="noopener" class="text-accent underline underline-offset-2 break-all">$1</a>');
  for (const label of [...mentions].sort((a, b) => b.length - a.length)) {
    const re = new RegExp(`(^|[^\\w])@(${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})(?![\\p{L}\\p{N}_])`, "giu");
    t = t.replace(re, '$1<span class="rounded bg-accent/[0.12] px-1 font-medium text-accent">@$2</span>');
  }
  return t;
}

/** Comment body → HTML. `mentions` are the labels to highlight as chips. */
export function renderComment(body: string, imageSrc: (id: string) => string, mentions: string[] = []): string {
  const lines = body.replace(/\r\n?/g, "\n").split("\n");
  const out: string[] = [];
  let list: "ul" | "ol" | null = null;
  const closeList = () => { if (list) { out.push(`</${list}>`); list = null; } };
  for (const raw of lines) {
    const bullet = /^\s*[-*]\s+(.*)$/.exec(raw);
    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(raw);
    if (bullet || numbered) {
      const kind = bullet ? "ul" : "ol";
      if (list !== kind) { closeList(); list = kind; out.push(kind === "ul" ? '<ul class="my-1 list-disc pl-5">' : '<ol class="my-1 list-decimal pl-5">'); }
      out.push(`<li>${inline((bullet ?? numbered)![1], imageSrc, mentions)}</li>`);
      continue;
    }
    closeList();
    if (raw.trim() === "") { out.push('<div class="h-2"></div>'); continue; }
    out.push(`<p>${inline(raw, imageSrc, mentions)}</p>`);
  }
  closeList();
  return out.join("");
}

/** The comment as plain words, for a Slack excerpt: markup marks dropped,
 *  an attached image becomes "[image]", list markers kept as "• ". */
export function plainText(body: string): string {
  return body
    .replace(/\r\n?/g, "\n")
    .replace(/!\[[^\]]*\]\(img:[A-Za-z0-9_-]+\)/g, "[image]")
    .replace(/\*\*([^*\n]+)\*\*/g, "$1").replace(/~~([^~\n]+)~~/g, "$1").replace(/`([^`\n]+)`/g, "$1")
    .replace(/(^|[^\w])_([^_\n]+)_(?=$|[^\w])/g, "$1$2")
    .replace(/^\s*[-*]\s+/gm, "• ").replace(/^\s*(\d+)[.)]\s+/gm, "$1. ")
    .replace(/\n{2,}/g, "\n").trim();
}

/**
 * Who is in this card's conversation: everyone who has commented and everyone
 * who has been mentioned, minus the person speaking now. A new comment pings
 * them all — that is what "reply" means on a thread with no reply button:
 * once two people are talking on a card, each hears the other.
 */
export function conversationMembers(
  prior: { authorId: string | null; mentionedIds: string[] }[],
  authorId: string | null,
): string[] {
  const ids = new Set<string>();
  for (const c of prior) { if (c.authorId) ids.add(c.authorId); for (const m of c.mentionedIds) ids.add(m); }
  if (authorId) ids.delete(authorId);
  return [...ids];
}
