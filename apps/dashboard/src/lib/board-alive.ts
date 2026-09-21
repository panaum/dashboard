// BOARD "ALIVE" — unread, presence, typing and aging, as pure functions.
//
// No I/O, no React, and no clock reads: `now` is always a parameter, so every
// window below can be tested at an exact instant instead of slept through.
//
// There is no realtime transport here and none in the stack (see the note in
// /api/boards/pulse). Everything in this file is written to be recomputed from
// a poll, which means it must be cheap and must tolerate a stale `now`.

import type { BoardStage } from "./constants";

// ── unread ──────────────────────────────────────────────────────────────────

/**
 * A card is unread for someone when something has happened on it since they
 * last looked — or when they have never looked at all.
 *
 * Derived rather than stored: nothing has to be marked read, a new event makes
 * a card unread again on its own, and there is no flag to drift.
 */
export function isUnread(
  latestEventAt: Date | string | null | undefined,
  viewedAt: Date | string | null | undefined,
): boolean {
  if (!latestEventAt) return false; // nothing has ever happened on it
  if (!viewedAt) return true; // never opened
  return new Date(latestEventAt).getTime() > new Date(viewedAt).getTime();
}

export function unreadCount<T extends { latestEventAt: Date | string | null; viewedAt: Date | string | null }>(
  cards: T[],
): number {
  return cards.reduce((n, c) => n + (isUnread(c.latestEventAt, c.viewedAt) ? 1 : 0), 0);
}

// ── presence and typing ─────────────────────────────────────────────────────

/** How long a heartbeat counts for. The client beats every 6s, so 30s
 *  tolerates four missed beats before someone is shown as gone. */
export const PRESENCE_WINDOW_MS = 30_000;
/** Typing is a much shorter claim: it should disappear on its own if someone
 *  stops mid-sentence, without waiting for them to close anything. */
export const TYPING_WINDOW_MS = 8_000;

export type PresenceRow = {
  memberId: string;
  name: string;
  projectId: string | null;
  seenAt: Date | string;
  typingIssueId: string | null;
  typingAt: Date | string | null;
};

const fresh = (at: Date | string | null | undefined, now: Date, windowMs: number) =>
  !!at && now.getTime() - new Date(at).getTime() < windowMs;

/** Who currently has this board open, excluding the person asking. */
export function presentOn(rows: PresenceRow[], projectId: string, now: Date, exclude?: string | null): { memberId: string; name: string }[] {
  return rows
    .filter((r) => r.projectId === projectId && r.memberId !== exclude && fresh(r.seenAt, now, PRESENCE_WINDOW_MS))
    .map((r) => ({ memberId: r.memberId, name: r.name }));
}

/** Who is mid-sentence on this card, excluding the person asking. Presence has
 *  to be fresh too — a stale heartbeat with a recent typing stamp means the
 *  tab was closed mid-word. */
export function typingOn(rows: PresenceRow[], issueId: string, now: Date, exclude?: string | null): string[] {
  return rows
    .filter((r) =>
      r.typingIssueId === issueId &&
      r.memberId !== exclude &&
      fresh(r.typingAt, now, TYPING_WINDOW_MS) &&
      fresh(r.seenAt, now, PRESENCE_WINDOW_MS))
    .map((r) => r.name);
}

/** "Priya is typing…", "Priya and Anaum are typing…", "3 people are typing…" */
export function typingLine(names: string[]): string | null {
  if (names.length === 0) return null;
  if (names.length === 1) return `${names[0]} is typing…`;
  if (names.length === 2) return `${names[0]} and ${names[1]} are typing…`;
  return `${names.length} people are typing…`;
}

// ── aging ───────────────────────────────────────────────────────────────────

/** A card sitting in one stage this long starts to glow. */
export const AGING_THRESHOLD_MS = 3 * 24 * 60 * 60 * 1000;

/**
 * How long a card has sat where it is, as a level rather than a number, so the
 * UI has something to switch on. 0 = fine; 1, 2, 3 = increasingly stale.
 *
 * Done is not stale: a card that has been Closed for a month is finished, not
 * neglected, so Completed and Closed never age.
 */
export function agingLevel(
  stageSince: Date | string | null | undefined,
  stage: BoardStage | null,
  now: Date,
  thresholdMs = AGING_THRESHOLD_MS,
): 0 | 1 | 2 | 3 {
  if (!stageSince || !stage) return 0;
  if (stage === "COMPLETED" || stage === "CLOSED") return 0;
  const age = now.getTime() - new Date(stageSince).getTime();
  if (age < thresholdMs) return 0;
  if (age < thresholdMs * 2) return 1;
  if (age < thresholdMs * 4) return 2;
  return 3;
}

/** "3 days in Active", for the card's tooltip — plain, no colour language. */
export function agingLabel(stageSince: Date | string, stageLabel: string, now: Date): string {
  const days = Math.floor((now.getTime() - new Date(stageSince).getTime()) / 86_400_000);
  if (days < 1) return `In ${stageLabel} since today`;
  return `${days} day${days === 1 ? "" : "s"} in ${stageLabel}`;
}

// ── small human things ──────────────────────────────────────────────────────

/** Derived from the VIEWER's clock, never the server's — a board opened in
 *  Srinagar at 9am should not say "Good evening" because a function in Sydney
 *  thinks so. */
export function greeting(hour: number, name?: string | null): string {
  const part = hour < 5 ? "Good evening" : hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  return name ? `${part}, ${name}` : part;
}

/** "12 cards closed this week" — team-wide and ambient. Never per person: a
 *  number beside someone's name is a scoreboard, and that was ruled out. */
export function closedThisWeekLine(count: number): string | null {
  if (count <= 0) return null;
  return `${count} card${count === 1 ? "" : "s"} closed this week`;
}

/** The start of the last 7 days, as a half-open window [from, now). */
export function weekWindow(now: Date): { from: Date } {
  return { from: new Date(now.getTime() - 7 * 86_400_000) };
}
