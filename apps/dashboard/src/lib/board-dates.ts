// BOARD DATES — due-date status, reminder selection, and the calendar grid,
// as pure functions. No clock reads: `now` is always a parameter.

import type { BoardStage } from "./constants";

/** The reference's reminder choices, in minutes before the due date. */
export const REMINDER_OPTIONS: { value: number | null; label: string }[] = [
  { value: null, label: "None" },
  { value: 0, label: "At time of due date" },
  { value: 5, label: "5 minutes before" },
  { value: 15, label: "15 minutes before" },
  { value: 60, label: "1 hour before" },
  { value: 60 * 2, label: "2 hours before" },
  { value: 60 * 24, label: "1 day before" },
  { value: 60 * 24 * 2, label: "2 days before" },
];

export type DueStatus = "none" | "done" | "overdue" | "due-soon" | "scheduled";

/** What the due chip says about a card. Done wins: a completed or closed card
 *  is never "overdue", however late it was. Due soon is within 24 hours. */
export function dueStatus(
  dueAt: string | Date | null | undefined, stage: BoardStage | null, now: Date,
): DueStatus {
  if (!dueAt) return "none";
  if (stage === "COMPLETED" || stage === "CLOSED") return "done";
  const due = new Date(dueAt).getTime();
  if (due < now.getTime()) return "overdue";
  if (due - now.getTime() <= 24 * 60 * 60 * 1000) return "due-soon";
  return "scheduled";
}

/** "21 Sep, 4:28pm" — the chip on the card face and the Dates block. */
export function dueLabel(iso: string | Date, timeZone?: string): string {
  const d = new Date(iso);
  const part = (opts: Intl.DateTimeFormatOptions, type: string) =>
    new Intl.DateTimeFormat("en-US", { ...opts, timeZone }).formatToParts(d).find((p) => p.type === type)?.value ?? "";
  const time = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", hour12: true, timeZone })
    .format(d).replace(/\s?(AM|PM)/, (m) => m.trim().toLowerCase());
  return `${part({ day: "numeric" }, "day")} ${part({ month: "short" }, "month")}, ${time}`;
}

/** A reminder may still go out this long after its moment — "at time of due
 *  date" would otherwise never fire, since the sweep runs on a schedule, and
 *  the once-only mark stops repeats. */
export const REMINDER_GRACE_MS = 60 * 60 * 1000;

/**
 * Cards whose reminder is due now: the reminder moment has passed, the due
 * date has not passed by more than the grace, nothing has been sent for this
 * due date yet, and the card is still open. Ordered by due date so the
 * sweep's log reads sensibly.
 */
export function remindersDue<T extends {
  dueAt: Date | string | null; dueReminderMinutes: number | null; dueRemindedAt: Date | string | null; boardStage: string | null;
}>(cards: T[], now: Date): T[] {
  return cards
    .filter((c) => {
      if (!c.dueAt || c.dueReminderMinutes === null || c.dueRemindedAt) return false;
      if (c.boardStage === "COMPLETED" || c.boardStage === "CLOSED" || !c.boardStage) return false;
      const due = new Date(c.dueAt).getTime();
      const remindAt = due - c.dueReminderMinutes * 60 * 1000;
      return remindAt <= now.getTime() && now.getTime() < due + REMINDER_GRACE_MS;
    })
    .sort((a, b) => new Date(a.dueAt!).getTime() - new Date(b.dueAt!).getTime());
}

/** The month as the reference draws it: six rows of seven, Monday first,
 *  leading and trailing days from the neighbouring months included. Each cell
 *  is a UTC-midnight date for the calendar day. */
export function monthGrid(year: number, month0: number): Date[][] {
  const first = new Date(Date.UTC(year, month0, 1));
  const lead = (first.getUTCDay() + 6) % 7; // Monday = 0
  const start = new Date(Date.UTC(year, month0, 1 - lead));
  const rows: Date[][] = [];
  for (let r = 0; r < 6; r++) {
    const row: Date[] = [];
    for (let c = 0; c < 7; c++) row.push(new Date(start.getTime() + (r * 7 + c) * 86400000));
    rows.push(row);
  }
  return rows;
}

/** "2026-09-21" for a calendar day (UTC-midnight cell). */
export function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}
