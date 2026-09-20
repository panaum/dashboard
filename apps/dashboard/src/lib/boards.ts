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
  role: Role,
  from: BoardStage | null,
  to: BoardStage,
  opts: { assigned: boolean } = { assigned: true },
): boolean {
  if (!isStage(to)) return false;
  if (from === to) return false;
  if (role === "qa") return true;
  if (!opts.assigned) return false;
  if (to === "CLOSED" || from === "CLOSED") return false;
  return true;
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
};

/**
 * Strip a card down to what the developer view is allowed to carry.
 *
 * Severity, the recurring flag and the reporter never leave the server for
 * this view — priority reaches the developer through card ORDER alone. This
 * is a whitelist, not a blacklist: a field added to Issue later is hidden by
 * default, not leaked by default.
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
  };
}

/**
 * The name a comment carries on the developer view. Only the card's own
 * assignee is named; every other voice on the thread — the reporter, another
 * QA, the shared session — is "QA". The reporter's identity never leaves the
 * server for this view, and it holds whether or not that person has a login.
 */
export function developerAuthorLabel(
  c: { authorId: string | null; authorName: string | null },
  assigneeId: string | null,
): string {
  if (assigneeId && c.authorId === assigneeId) return c.authorName ?? "Developer";
  return "QA";
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
