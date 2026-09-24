import { test } from "node:test";
import assert from "node:assert/strict";
import { NOTIFY_KINDS, isTimeZone, wantsPing, zoneFor } from "./preferences";

test("every ping is on unless the person turned it off", () => {
  assert.equal(wantsPing(null, "mentions"), true);
  assert.equal(wantsPing({}, "replies"), true);
  assert.equal(wantsPing({ notifyMentions: true }, "mentions"), true);
  assert.equal(wantsPing({ notifyMentions: false }, "mentions"), false);
});

test("each switch governs only its own kind", () => {
  const prefs = { notifyMentions: false, notifyReplies: true, notifyDueReminders: false };
  assert.equal(wantsPing(prefs, "mentions"), false);
  assert.equal(wantsPing(prefs, "replies"), true);
  assert.equal(wantsPing(prefs, "dueReminders"), false);
});

test("the three kinds map to three distinct columns", () => {
  assert.equal(new Set(NOTIFY_KINDS.map((k) => k.column)).size, 3);
});

test("time zones are validated, not trusted", () => {
  assert.equal(isTimeZone("Asia/Kolkata"), true);
  assert.equal(isTimeZone("UTC"), true);
  assert.equal(isTimeZone("Mars/Olympus"), false);
  assert.equal(isTimeZone(""), false);
  assert.equal(isTimeZone(null), false);
});

test("a person's zone wins; a bad or missing one falls back", () => {
  assert.equal(zoneFor("Europe/London", "Asia/Kolkata"), "Europe/London");
  assert.equal(zoneFor(null, "Asia/Kolkata"), "Asia/Kolkata");
  assert.equal(zoneFor("Nowhere/Real", "UTC"), "UTC");
  assert.equal(zoneFor(null), undefined);
});
