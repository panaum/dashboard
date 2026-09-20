import test from "node:test";
import assert from "node:assert/strict";

import {
  canMove, developerView, developerAuthorLabel, inStage, isBounceBack, nextOrder, reorder,
} from "./boards";

// ── the quality signal ──────────────────────────────────────────────────────

test("a bounce-back is QA pulling a card back out of done into work", () => {
  assert.equal(isBounceBack("COMPLETED", "ACTIVE"), true);
  assert.equal(isBounceBack("CLOSED", "ACTIVE"), true);
  // Everything else is ordinary movement, not a rejection.
  assert.equal(isBounceBack("NEW", "ACTIVE"), false);
  assert.equal(isBounceBack("COMPLETED", "CLOSED"), false);
  assert.equal(isBounceBack("COMPLETED", "NEEDS_CLARIFICATION"), false);
  assert.equal(isBounceBack(null, "ACTIVE"), false);
});

// ── who may move what ───────────────────────────────────────────────────────

test("QA may move anything anywhere, including backward", () => {
  assert.equal(canMove("qa", "CLOSED", "ACTIVE"), true);
  assert.equal(canMove("qa", "NEW", "CLOSED"), true);
  assert.equal(canMove("qa", null, "NEW"), true);
});

test("a developer works their own cards and hands them to QA, but never closes", () => {
  assert.equal(canMove("developer", "NEW", "ACTIVE"), true);
  assert.equal(canMove("developer", "ACTIVE", "NEEDS_CLARIFICATION"), true);
  assert.equal(canMove("developer", "ACTIVE", "COMPLETED"), true, "hands it to QA");
  assert.equal(canMove("developer", "COMPLETED", "ACTIVE"), true, "may take it back before QA looks");
  // "Developer says done" and "QA confirmed" must be two people's acts.
  assert.equal(canMove("developer", "COMPLETED", "CLOSED"), false);
  assert.equal(canMove("developer", "CLOSED", "ACTIVE"), false, "only QA reopens a closed card");
});

test("a developer cannot move a card that is not theirs", () => {
  assert.equal(canMove("developer", "NEW", "ACTIVE", { assigned: false }), false);
});

test("a move to the same stage, or to no stage, is not a move", () => {
  assert.equal(canMove("qa", "ACTIVE", "ACTIVE"), false);
  assert.equal(canMove("qa", "ACTIVE", "nowhere" as never), false);
});

// ── what the developer link is allowed to carry ─────────────────────────────

test("the developer view is a whitelist, so a new field is hidden by default", () => {
  const full = {
    id: "i1", title: "Phone field has no label", description: "…", link: "https://x/y",
    boardStage: "NEW" as const, boardOrder: 0, assigneeId: "dev1", createdAt: "2026-09-20",
    // Everything below must never reach the developer.
    severity: "CRITICAL_HIGH", recurring: true, reporterId: "qa1", status: "OPEN",
    somethingAddedLater: "leaks by default unless this is a whitelist",
  };
  const seen = developerView(full);
  assert.deepEqual(Object.keys(seen).sort(),
    ["assigneeId", "boardOrder", "boardStage", "createdAt", "description", "id", "link", "title"]);
  assert.ok(!("severity" in seen) && !("recurring" in seen) && !("reporterId" in seen));
  assert.ok(!("somethingAddedLater" in seen));
});

// ── order is the priority signal, so it must persist and stay dense ─────────

const cards = [
  { id: "a", boardStage: "NEW", boardOrder: 0 },
  { id: "b", boardStage: "NEW", boardOrder: 1 },
  { id: "c", boardStage: "NEW", boardOrder: 2 },
  { id: "z", boardStage: "ACTIVE", boardOrder: 0 },
];

test("a stage lists its cards in the order QA arranged them", () => {
  assert.deepEqual(inStage(cards, "NEW").map((c) => c.id), ["a", "b", "c"]);
  assert.deepEqual(inStage(cards, "CLOSED"), []);
});

test("a new card lands at the bottom", () => {
  assert.equal(nextOrder(cards, "NEW"), 3);
  assert.equal(nextOrder(cards, "CLOSED"), 0);
});

test("dropping a card at an index re-numbers the stage densely", () => {
  // c moves to the top of NEW.
  assert.deepEqual(reorder(cards, "NEW", "c", 0),
    [{ id: "c", boardOrder: 0 }, { id: "a", boardOrder: 1 }, { id: "b", boardOrder: 2 }]);
  // z moves INTO NEW between a and b — cross-stage drop.
  assert.deepEqual(reorder(cards, "NEW", "z", 1),
    [{ id: "a", boardOrder: 0 }, { id: "z", boardOrder: 1 }, { id: "b", boardOrder: 2 }, { id: "c", boardOrder: 3 }]);
  // An index past the end clamps to the bottom rather than leaving a gap.
  assert.deepEqual(reorder(cards, "NEW", "a", 99).map((r) => r.id), ["b", "c", "a"]);
});

// ── the thread, as the developer may see it ─────────────────────────────────

test("developer view names only the card's own assignee on the thread", () => {
  const dev = "dev-1";
  // The developer's own words carry their name.
  assert.equal(developerAuthorLabel({ authorId: dev, authorName: "Priya" }, dev), "Priya");
  // The reporter's name never crosses — that is the whole point of this view.
  assert.equal(developerAuthorLabel({ authorId: "qa-1", authorName: "Anaum" }, dev), "QA");
  // A comment from the shared session has no author; it is still "QA", never "Developer".
  assert.equal(developerAuthorLabel({ authorId: null, authorName: null }, dev), "QA");
  // Unassigned card: nobody is "the developer", so nobody is named.
  assert.equal(developerAuthorLabel({ authorId: dev, authorName: "Priya" }, null), "QA");
  // Assignee row gone (SetNull) but id still matches: a label, not a leak.
  assert.equal(developerAuthorLabel({ authorId: dev, authorName: null }, dev), "Developer");
});
