import test from "node:test";
import assert from "node:assert/strict";

import {
  AGING_THRESHOLD_MS, agingLabel, agingLevel, closedThisWeekLine, greeting,
  isNews, isUnread, latestActivity, presentOn, typingLine, typingOn, unreadCount,
  weekWindow,
} from "./board-alive";

const now = new Date("2026-09-21T12:00:00.000Z");
const ago = (ms: number) => new Date(now.getTime() - ms).toISOString();

// ── unread ──────────────────────────────────────────────────────────────────

test("a card is unread when something happened after you last looked", () => {
  assert.equal(isUnread(ago(1000), ago(60_000)), true, "event newer than the view");
  assert.equal(isUnread(ago(60_000), ago(1000)), false, "you looked after it happened");
  assert.equal(isUnread(ago(1000), null), true, "never opened");
  // Nothing has ever happened on it — every card has at least a creation
  // event, so this is the defensive case, not the normal one.
  assert.equal(isUnread(null, null), false);
  // Same instant is read: opening a card writes the view after the event.
  assert.equal(isUnread(now, now), false);
});

test("unreadCount counts cards, not events", () => {
  assert.equal(unreadCount([
    { latestEventAt: ago(1000), viewedAt: ago(9000) },   // unread
    { latestEventAt: ago(9000), viewedAt: ago(1000) },   // read
    { latestEventAt: ago(1000), viewedAt: null },        // never opened
  ]), 2);
  assert.equal(unreadCount([]), 0);
});

// ── presence ────────────────────────────────────────────────────────────────

const rows = [
  { memberId: "qa-1", name: "Anaum", projectId: "p1", seenAt: ago(3_000), typingIssueId: "i1", typingAt: ago(2_000) },
  { memberId: "dev-1", name: "Priya", projectId: "p1", seenAt: ago(5_000), typingIssueId: null, typingAt: null },
  { memberId: "dev-2", name: "Tajamul", projectId: "p1", seenAt: ago(90_000), typingIssueId: "i1", typingAt: ago(1_000) },
  { memberId: "qa-2", name: "Babar", projectId: "p2", seenAt: ago(1_000), typingIssueId: null, typingAt: null },
];

test("presence is per board, excludes you, and expires on a stale heartbeat", () => {
  assert.deepEqual(presentOn(rows, "p1", now, "qa-1").map((p) => p.name), ["Priya"]);
  // Tajamul's heartbeat is 90s old — beyond the window, so he is gone even
  // though his typing stamp is a second old (a tab closed mid-word).
  assert.ok(!presentOn(rows, "p1", now).some((p) => p.name === "Tajamul"));
  // Another board's viewers are not on this one.
  assert.ok(!presentOn(rows, "p1", now).some((p) => p.name === "Babar"));
  assert.deepEqual(presentOn(rows, "p2", now).map((p) => p.name), ["Babar"]);
});

test("typing needs a fresh keystroke AND a live heartbeat", () => {
  assert.deepEqual(typingOn(rows, "i1", now, "dev-1"), ["Anaum"]);
  // You are never told that you are typing.
  assert.deepEqual(typingOn(rows, "i1", now, "qa-1"), []);
  // A keystroke older than the typing window has stopped being news.
  const stale = [{ ...rows[0], typingAt: ago(20_000) }];
  assert.deepEqual(typingOn(stale, "i1", now), []);
  // Typing on a different card is not typing on this one.
  assert.deepEqual(typingOn(rows, "i2", now), []);
});

test("the typing line reads like a sentence at every count", () => {
  assert.equal(typingLine([]), null);
  assert.equal(typingLine(["Anaum"]), "Anaum is typing…");
  assert.equal(typingLine(["Anaum", "Priya"]), "Anaum and Priya are typing…");
  assert.equal(typingLine(["Anaum", "Priya", "Tajamul"]), "3 people are typing…");
});

// ── aging ───────────────────────────────────────────────────────────────────

test("aging climbs with time in one stage, and done cards never age", () => {
  const day = 86_400_000;
  assert.equal(agingLevel(ago(day), "ACTIVE", now), 0, "younger than the threshold");
  assert.equal(agingLevel(ago(4 * day), "ACTIVE", now), 1);
  assert.equal(agingLevel(ago(8 * day), "NEW", now), 2);
  assert.equal(agingLevel(ago(20 * day), "NEEDS_CLARIFICATION", now), 3);
  // Finished is not neglected.
  assert.equal(agingLevel(ago(60 * day), "COMPLETED", now), 0);
  assert.equal(agingLevel(ago(60 * day), "CLOSED", now), 0);
  // Missing data never glows.
  assert.equal(agingLevel(null, "ACTIVE", now), 0);
  assert.equal(agingLevel(ago(60 * day), null, now), 0);
  // The threshold is a parameter, not a constant baked into the UI.
  assert.equal(agingLevel(ago(90 * 60_000), "ACTIVE", now, 3600_000), 1, "1.5× the threshold");
  // The boundaries are half-open: exactly 2× is already the next level up.
  assert.equal(agingLevel(ago(2 * 3600_000), "ACTIVE", now, 3600_000), 2);
  assert.equal(AGING_THRESHOLD_MS, 3 * day);
});

test("the aging tooltip counts whole days and says where", () => {
  assert.equal(agingLabel(ago(4 * 86_400_000), "Active", now), "4 days in Active");
  assert.equal(agingLabel(ago(86_400_000), "New", now), "1 day in New");
  assert.equal(agingLabel(ago(3600_000), "Active", now), "In Active since today");
});

// ── human touches ───────────────────────────────────────────────────────────

test("the greeting follows the viewer's own hour", () => {
  assert.equal(greeting(9, "Anaum"), "Good morning, Anaum");
  assert.equal(greeting(14, "Anaum"), "Good afternoon, Anaum");
  assert.equal(greeting(20, "Anaum"), "Good evening, Anaum");
  assert.equal(greeting(2, "Anaum"), "Good evening, Anaum", "2am is still the night before");
  // The shared login has no name to greet.
  assert.equal(greeting(9, null), "Good morning");
});

test("the weekly line is ambient, plural-correct, and silent at zero", () => {
  assert.equal(closedThisWeekLine(12), "12 cards closed this week");
  assert.equal(closedThisWeekLine(1), "1 card closed this week");
  assert.equal(closedThisWeekLine(0), null);
  assert.equal(closedThisWeekLine(-3), null);
  assert.equal(weekWindow(now).from.toISOString(), "2026-09-14T12:00:00.000Z");
});

// ── activity / news ─────────────────────────────────────────────────────────

test("the newest activity wins, and an empty board has none", () => {
  const move = { at: ago(5_000), actorId: "dev-1" };
  const talk = { at: ago(1_000), actorId: "qa-1" };
  assert.deepEqual(latestActivity([move, talk]), talk);
  assert.deepEqual(latestActivity([talk, move]), talk);
  assert.deepEqual(latestActivity([null, move, undefined]), move);
  assert.equal(latestActivity([null, undefined]), null);
});

test("news is newer than what you were told, and done by someone else", () => {
  const seen = ago(10_000);
  assert.equal(isNews(seen, { at: ago(1_000), actorId: "dev-1" }, "qa-1"), true);
  // Your own move is not news to you — this is the whole reason the actor is
  // carried across the wire at all.
  assert.equal(isNews(seen, { at: ago(1_000), actorId: "qa-1" }, "qa-1"), false);
  // Older than the last thing you heard, or exactly it: already delivered.
  assert.equal(isNews(seen, { at: ago(30_000), actorId: "dev-1" }, "qa-1"), false);
  assert.equal(isNews(seen, { at: seen, actorId: "dev-1" }, "qa-1"), false);
  // The first beat after a page load tells you nothing: the board you are
  // looking at is not an event.
  assert.equal(isNews(null, { at: ago(1_000), actorId: "dev-1" }, "qa-1"), false);
  assert.equal(isNews(seen, null, "qa-1"), false);
  // The shared login is nobody in particular: news to a person, and not news
  // to the shared login, which may well have been the one who did it.
  assert.equal(isNews(seen, { at: ago(1_000), actorId: null }, "qa-1"), true);
  assert.equal(isNews(seen, { at: ago(1_000), actorId: null }, null), false);
});
