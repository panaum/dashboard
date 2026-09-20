import test from "node:test";
import assert from "node:assert/strict";

import { dayKey, dueLabel, dueStatus, monthGrid, remindersDue } from "./board-dates";

const now = new Date("2026-09-20T10:00:00.000Z");

test("due status: done beats overdue; soon is within a day; none without a date", () => {
  assert.equal(dueStatus(null, "ACTIVE", now), "none");
  assert.equal(dueStatus("2026-09-19T10:00:00.000Z", "ACTIVE", now), "overdue");
  assert.equal(dueStatus("2026-09-19T10:00:00.000Z", "CLOSED", now), "done");
  assert.equal(dueStatus("2026-09-21T09:00:00.000Z", "ACTIVE", now), "due-soon");
  assert.equal(dueStatus("2026-09-21T10:00:01.000Z", "NEW", now), "scheduled");
});

test("due label reads like the reference's chip", () => {
  assert.equal(dueLabel("2026-09-21T10:58:00.000Z", "Asia/Kolkata"), "21 Sep, 4:28pm");
  assert.equal(dueLabel("2026-09-21T00:05:00.000Z", "UTC"), "21 Sep, 12:05am");
});

test("reminders fire once, in the window, only for open cards", () => {
  const cards = [
    { id: "in-window", dueAt: "2026-09-20T11:00:00.000Z", dueReminderMinutes: 60, dueRemindedAt: null, boardStage: "ACTIVE" },
    { id: "too-early", dueAt: "2026-09-20T12:00:00.000Z", dueReminderMinutes: 60, dueRemindedAt: null, boardStage: "ACTIVE" },
    { id: "already-sent", dueAt: "2026-09-20T11:00:00.000Z", dueReminderMinutes: 60, dueRemindedAt: "2026-09-20T09:59:00.000Z", boardStage: "ACTIVE" },
    { id: "past-due", dueAt: "2026-09-20T09:00:00.000Z", dueReminderMinutes: 60, dueRemindedAt: null, boardStage: "ACTIVE" },
    { id: "closed", dueAt: "2026-09-20T11:00:00.000Z", dueReminderMinutes: 60, dueRemindedAt: null, boardStage: "CLOSED" },
    { id: "no-reminder", dueAt: "2026-09-20T11:00:00.000Z", dueReminderMinutes: null, dueRemindedAt: null, boardStage: "ACTIVE" },
    { id: "at-due-time", dueAt: "2026-09-20T10:00:00.000Z", dueReminderMinutes: 0, dueRemindedAt: null, boardStage: "NEW" },
  ];
  // "At time of due date" fires at the due moment; a reminder is still sent up
  // to an hour late (the sweep is scheduled, not instant) but "past-due" at
  // 09:00 is beyond that.
  assert.deepEqual(remindersDue(cards, now).map((c) => c.id), ["at-due-time", "in-window"]);
  assert.deepEqual(remindersDue(cards, new Date("2026-09-20T09:30:00.000Z")).map((c) => c.id), ["past-due"]);
});

test("the month grid is six Monday-first rows with neighbours filled in", () => {
  const g = monthGrid(2026, 8); // September 2026 starts on a Tuesday
  assert.equal(g.length, 6); assert.ok(g.every((r) => r.length === 7));
  assert.equal(dayKey(g[0][0]), "2026-08-31");
  assert.equal(dayKey(g[0][1]), "2026-09-01");
  assert.equal(dayKey(g[4][1]), "2026-09-29");
  assert.equal(dayKey(g[5][6]), "2026-10-11");
});
