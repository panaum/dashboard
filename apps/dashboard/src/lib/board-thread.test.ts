import test from "node:test";
import assert from "node:assert/strict";

import {
  activityFeed, coverOf, eventLine, formatWhen, initials, mentionLabelsFor, parseMentions, participantsFor, slackMentionText,
} from "./board-thread";

const card = { reporterId: "qa-1", reporterName: "Anaum", assigneeId: "dev-1", assigneeName: "Priya Sharma" };

// ── who may be mentioned ────────────────────────────────────────────────────

test("QA may mention the assignee and the reporter, by name", () => {
  assert.deepEqual(participantsFor("qa", card), [
    { id: "dev-1", label: "Priya Sharma" }, { id: "qa-1", label: "Anaum" },
  ]);
});

test("the developer may mention the reporter only, and only as QA", () => {
  // The reporter's name never leaves the server for this view; the id still resolves.
  assert.deepEqual(participantsFor("developer", card), [{ id: "qa-1", label: "QA" }]);
  // A card from the shared session has no reporter: nobody to ping.
  assert.deepEqual(participantsFor("developer", { ...card, reporterId: null, reporterName: null }), []);
});

test("nobody appears twice, and an unassigned card offers only the reporter", () => {
  assert.deepEqual(participantsFor("qa", { ...card, assigneeId: "qa-1", assigneeName: "Anaum" }), [{ id: "qa-1", label: "Anaum" }]);
  assert.deepEqual(participantsFor("qa", { ...card, assigneeId: null, assigneeName: null }), [{ id: "qa-1", label: "Anaum" }]);
});

// ── what a body mentions ────────────────────────────────────────────────────

test("mentions resolve to participant ids, in order, case-insensitively, once each", () => {
  const ps = participantsFor("qa", card);
  assert.deepEqual(parseMentions("@anaum can you check? @Priya Sharma fixed it, @Anaum", ps), ["qa-1", "dev-1"]);
});

test("a longer label wins, a word boundary is required, and strangers are text", () => {
  const ps = [{ id: "a", label: "Priya" }, { id: "b", label: "Priya Sharma" }];
  assert.deepEqual(parseMentions("@Priya Sharma please", ps), ["b"]);
  assert.deepEqual(parseMentions("@Priya please", ps), ["a"]);
  assert.deepEqual(parseMentions("@Priyanka please", ps), []);
  // Whoever the client claims to mention, only the card's participants resolve.
  assert.deepEqual(parseMentions("@ceo @everyone", ps), []);
});

// ── the feed ────────────────────────────────────────────────────────────────

test("comments and stage events interleave by time; a move precedes a comment at the same instant", () => {
  const feed = activityFeed(
    [{ id: "c1", body: "Still broken", authorName: "Anaum", createdAt: "2026-09-12T09:34:00.000Z" }],
    [
      { id: "e1", actorName: "Anaum", fromStage: null, toStage: "NEW", createdAt: "2026-09-12T09:00:00.000Z" },
      { id: "e2", actorName: "Priya", fromStage: "ACTIVE", toStage: "COMPLETED", createdAt: "2026-09-12T09:34:00.000Z" },
    ],
  );
  assert.deepEqual(feed.map((i) => i.id), ["e1", "e2", "c1"]);
  assert.equal(feed[0].kind, "event");
  assert.equal((feed[1] as { text: string }).text, "Priya moved this card from Active to Completed");
  assert.equal((feed[0] as { text: string }).text, "Anaum added this card to New");
});

test("an event with no actor still reads as a sentence", () => {
  assert.equal(eventLine({ actorName: null, fromStage: "COMPLETED", toStage: "ACTIVE" }), "Someone moved this card from Completed to Active");
});

// ── cover, initials, time, Slack ────────────────────────────────────────────

test("the cover is the flagged image; none flagged means no banner", () => {
  assert.equal(coverOf([{ id: 1, isCover: false, bytes: 9 }]), null);
  assert.equal(coverOf([{ id: 1, isCover: true, bytes: 9 }, { id: 2, isCover: true, bytes: 90 }])?.id, 2);
});

test("initials", () => {
  assert.equal(initials("Priya Sharma"), "PS");
  assert.equal(initials("Priya"), "P");
  assert.equal(initials("  Anaum  Q  Test "), "AT");
  assert.equal(initials(""), "?");
});

test("formatWhen reads like a person wrote it, in the given zone", () => {
  assert.equal(formatWhen("2026-09-12T15:04:00.000Z", "UTC"), "12 Sep, 3:04pm");
  assert.equal(formatWhen("2026-09-12T15:04:00.000Z", "Asia/Kolkata"), "12 Sep, 8:34pm");
});

test("the Slack line pings by id, escapes markup, and truncates long bodies", () => {
  const t = slackMentionText({
    slackUserId: "U0AB", byName: "Anaum <QA>", cardTitle: "A & B", boardName: "LP", body: "x".repeat(200), url: "https://d.example/b/t",
  });
  assert.ok(t.startsWith("<@U0AB> *Anaum &lt;QA&gt;* mentioned you on *A &amp; B* (LP): \"" + "x".repeat(139) + "…\""));
  assert.ok(t.endsWith("<https://d.example/b/t|Open card>"));
});

test("the composer never offers the viewer their own name; the shared session sees everyone", () => {
  assert.deepEqual(mentionLabelsFor("qa", card, "qa-1"), ["Priya Sharma"]);
  assert.deepEqual(mentionLabelsFor("qa", card, "dev-1"), ["Anaum"]);
  assert.deepEqual(mentionLabelsFor("qa", card, "bootstrap"), ["Priya Sharma", "Anaum"]);
  assert.deepEqual(mentionLabelsFor("developer", card, "dev-1"), ["QA"]);
});
