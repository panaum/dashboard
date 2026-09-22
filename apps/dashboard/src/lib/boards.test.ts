import test from "node:test";
import assert from "node:assert/strict";

import {
  canMove, developerView, inStage, isBounceBack, moveNeedsReason, nextOrder, reorder,
  threadAuthorLabel,
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

test("a developer may make every move QA can, including closing and reopening", () => {
  // This used to be a whitelist: own cards only, never in or out of Closed.
  // The developer is the person looking at the board, the rule mostly produced
  // a red banner, and every move is recorded with its actor either way — the
  // audit trail was always the real control, not the permission.
  for (const [from, to] of [
    ["NEW", "ACTIVE"], ["ACTIVE", "NEEDS_CLARIFICATION"], ["ACTIVE", "COMPLETED"],
    ["COMPLETED", "ACTIVE"], ["COMPLETED", "CLOSED"], ["CLOSED", "ACTIVE"],
  ] as const) {
    assert.equal(canMove("developer", from, to), true, `${from} → ${to}`);
    assert.equal(canMove("qa", from, to), true, `qa ${from} → ${to}`);
  }
});

test("an unassigned card is no longer a special case", () => {
  assert.equal(canMove("developer", "NEW", "ACTIVE"), true);
});

test("only the move into Discussed demands a reason", () => {
  assert.equal(moveNeedsReason("NEEDS_CLARIFICATION", "ACTIVE"), true);
  assert.equal(moveNeedsReason("NEEDS_CLARIFICATION", "NEW"), true);
  assert.equal(moveNeedsReason("NEEDS_CLARIFICATION", null), true);
  // Reordering within the column is not entering it again.
  assert.equal(moveNeedsReason("NEEDS_CLARIFICATION", "NEEDS_CLARIFICATION"), false);
  // Leaving it, and every other move, needs nothing.
  assert.equal(moveNeedsReason("ACTIVE", "NEEDS_CLARIFICATION"), false);
  assert.equal(moveNeedsReason("COMPLETED", "ACTIVE"), false);
  assert.equal(moveNeedsReason("CLOSED", null), false);
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
    startAt: null, dueAt: "2026-09-21T10:58:00.000Z", // the deadline is the developer's to see
    // Everything below must never reach the developer.
    severity: "CRITICAL_HIGH", recurring: true, reporterId: "qa1", status: "OPEN", dueReminderMinutes: 60,
    somethingAddedLater: "leaks by default unless this is a whitelist",
  };
  const seen = developerView(full);
  assert.deepEqual(Object.keys(seen).sort(),
    ["assigneeId", "boardOrder", "boardStage", "createdAt", "description", "dueAt", "id", "link", "startAt", "title"]);
  assert.ok(!("severity" in seen) && !("recurring" in seen) && !("reporterId" in seen) && !("dueReminderMinutes" in seen));
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

test("a thread names whoever spoke, and the shared login is nobody in particular", () => {
  // Both sides see real names now — the developer is no longer shown "QA" in
  // place of the reporter (operator's call, 2026-09-21).
  assert.equal(threadAuthorLabel({ authorId: "dev-1", authorName: "Priya" }), "Priya");
  assert.equal(threadAuthorLabel({ authorId: "qa-1", authorName: "Anaum" }), "Anaum");
  // No row behind the author: the shared team password. Not "Developer", not
  // a guess — "QA", the same as the QA side shows.
  assert.equal(threadAuthorLabel({ authorId: null, authorName: null }), "QA");
  // An author whose row was deleted (SetNull leaves the id, name is gone).
  assert.equal(threadAuthorLabel({ authorId: "gone", authorName: null }), "QA");
});
