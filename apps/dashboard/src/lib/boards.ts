// The rules of a board. Pure — no DB, no React, no clock — so every rule is a
// unit test rather than a screenshot.
//
// The board is a project's issues that carry a boardStage. Two roles look at
// it: QA, through the app, and a developer, through a capability link. The
// data model is one; the difference between the two is entirely what this
// module lets each of them see and do.

import { BOARD_STAGES, type BoardStage } from "./constants";

export type Role = "qa" | "developer";

export const STAGE_ORDER: Record<BoardStage, number> = {
  NEW: 0,
  ACTIVE: 1,
  NEEDS_CLARIFICATION: 2,
  COMPLETED: 3,
  CLOSED: 4,
};

export function isStage(value: unknown): value is BoardStage {
  return typeof value === "string" && (BOARD_STAGES as readonly string[]).includes(value);
}

/**
 * A rejection: QA pulling a card back out of "done" into work. This is the
 * quality signal — a raw closed count rewards cherry-picking easy tickets,
 * and a bounce-back is the one thing a developer cannot inflate.
 */
export function isBounceBack(from: BoardStage | null, to: BoardStage): boolean {
  return (from === "COMPLETED" || from === "CLOSED") && to === "ACTIVE";
}

/**
 * Whether a move is allowed, by role.
 *
 * QA may move anything anywhere — including backward, which is how a fix is
 * rejected. A developer may move a card they are assigned to between the
 * working stages, and may hand it to QA (COMPLETED), but only QA closes and
 * only QA re-opens a closed card: "the developer says done" and "QA confirmed"
 * must stay two different people's acts, or the metric between them is
 * meaningless.
 */
export function canMove(
  _role: Role,
  from: BoardStage | null,
  to: BoardStage,
): boolean {
  // EVERY MOVE IS EVERYBODY'S TO MAKE.
  //
  // This used to gate the developer: only a card assigned to them, never in or
  // out of Closed, and anything else came back "That move is QA's to make." In
  // practice the developer is the person looking at the board, the rule mostly
  // produced a red banner, and every move is recorded as an IssueEvent with
  // its actor anyway — the audit trail was always the real control, not the
  // permission. The role argument stays so callers do not all have to change,
  // and so a future rule has somewhere to live.
  if (!isStage(to)) return false;
  return from !== to;
}

/** Moving into this stage requires a written reason. Asking "why" at the one
 *  point where work stops is the whole value of the stage. */
export const STAGE_NEEDS_REASON: BoardStage = "NEEDS_CLARIFICATION";

export function moveNeedsReason(to: BoardStage, from: BoardStage | null): boolean {
  return to === STAGE_NEEDS_REASON && from !== to;
}

/** What a card looks like to the developer holding a board link. */
export type DeveloperCard = {
  id: string;
  title: string;
  description: string | null;
  link: string | null;
  boardStage: BoardStage;
  boardOrder: number;
  assigneeId: string | null;
  createdAt: Date | string;
  startAt: Date | string | null;
  dueAt: Date | string | null;
};

/**
 * Strip a card down to what the developer view is allowed to carry.
 *
 * Severity and the recurring flag never leave the server for this view —
 * priority reaches the developer through card ORDER alone. This is a
 * whitelist, not a blacklist: a field added to Issue later is hidden by
 * default, not leaked by default.
 *
 * The reporter's NAME is no longer among the hidden things. It used to be —
 * the developer saw "QA" — but the Slack DM names the sender in full, so the
 * anonymity only ever held for a developer who never read their
 * notifications. Operator's call, 2026-09-21: name people on both. The
 * reporter's *id* still does not leave the server; only the display name
 * reaches the client, through the labels built in board-thread.ts.
 */
export function developerView<T extends DeveloperCard & Record<string, unknown>>(
  card: T,
): DeveloperCard {
  return {
    id: card.id,
    title: card.title,
    description: card.description ?? null,
    link: card.link ?? null,
    boardStage: card.boardStage,
    boardOrder: card.boardOrder,
    assigneeId: card.assigneeId ?? null,
    createdAt: card.createdAt,
    startAt: card.startAt ?? null,
    dueAt: card.dueAt ?? null,
  };
}

/**
 * The name a comment or a stage change carries on a board thread — the same
 * rule for both views now: whoever did it, by name.
 *
 * A null author is not a person: that work came from the shared team login,
 * which nobody can be held to. It reads "QA", exactly as it does on the QA
 * side, rather than inventing an attribution.
 */
export function threadAuthorLabel(c: { authorId: string | null; authorName: string | null }): string {
  return c.authorName ?? "QA";
}

/** Cards of one stage, in the order QA arranged them. */
export function inStage<T extends { boardStage: string | null; boardOrder: number }>(
  cards: T[],
  stage: BoardStage,
): T[] {
  return cards
    .filter((c) => c.boardStage === stage)
    .sort((a, b) => a.boardOrder - b.boardOrder);
}

/** The order a new card takes at the bottom of a stage. */
export function nextOrder<T extends { boardStage: string | null; boardOrder: number }>(
  cards: T[],
  stage: BoardStage,
): number {
  const here = inStage(cards, stage);
  return here.length ? here[here.length - 1].boardOrder + 1 : 0;
}

/**
 * Where a card lands when dropped at `index` within `stage`, and the orders
 * every other card in that stage takes so the list stays dense. Returns the
 * full list of (id, order) writes; the caller persists them in one transaction.
 */
export function reorder<T extends { id: string; boardStage: string | null; boardOrder: number }>(
  cards: T[],
  stage: BoardStage,
  movingId: string,
  index: number,
): Array<{ id: string; boardOrder: number }> {
  const others = inStage(cards, stage).filter((c) => c.id !== movingId);
  const at = Math.max(0, Math.min(index, others.length));
  const ids = [...others.slice(0, at).map((c) => c.id), movingId, ...others.slice(at).map((c) => c.id)];
  return ids.map((id, boardOrder) => ({ id, boardOrder }));
}
