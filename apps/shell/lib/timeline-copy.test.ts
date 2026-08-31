import { test } from "node:test";
import assert from "node:assert/strict";
import { orderNewestFirst, formatEventDate, TIMELINE_EMPTY_COPY } from "./timeline-copy.ts";
import type { TimelineEvent } from "./living-certificate.ts";

const signedOff: TimelineEvent = {
  at: "2026-07-28T09:00:00.000Z",
  kind: "signed_off",
  title: "Quality assurance signed off",
  detail: "38 checks passed",
};
const handed: TimelineEvent = {
  at: "2026-07-20T09:00:00.000Z",
  kind: "handed_to_qa",
  title: "Handed to quality assurance",
  detail: null,
};

// ═══ ORDER ═══
test("newest first", () => {
  assert.deepEqual(
    orderNewestFirst([handed, signedOff]).map((e) => e.kind),
    ["signed_off", "handed_to_qa"],
  );
});

test("already-ordered input is unchanged", () => {
  assert.deepEqual(
    orderNewestFirst([signedOff, handed]).map((e) => e.kind),
    ["signed_off", "handed_to_qa"],
  );
});

// The section promises chronology; it must keep that promise itself rather than
// inheriting whatever order arrived.
test("a mis-ordered upstream is corrected, not rendered as received", () => {
  const middle: TimelineEvent = { ...handed, at: "2026-07-24T09:00:00.000Z" };
  const out = orderNewestFirst([handed, signedOff, middle]);
  assert.deepEqual(out.map((e) => e.at), [signedOff.at, middle.at, handed.at]);
});

test("the input array is not mutated", () => {
  const input = [handed, signedOff];
  orderNewestFirst(input);
  assert.deepEqual(input.map((e) => e.kind), ["handed_to_qa", "signed_off"]);
});

test("events sharing a timestamp keep their arrival order", () => {
  const a: TimelineEvent = { ...handed, title: "A" };
  const b: TimelineEvent = { ...handed, title: "B" };
  assert.deepEqual(orderNewestFirst([a, b]).map((e) => e.title), ["A", "B"]);
});

test("an empty list stays empty", () => {
  assert.deepEqual(orderNewestFirst([]), []);
});

// ═══ DATES ═══
test("formats as a plain UTC date, matching the /c/ certificate", () => {
  assert.equal(formatEventDate("2026-07-28T09:00:00.000Z"), "28 July 2026");
  assert.equal(formatEventDate("2026-01-01T00:00:00.000Z"), "1 January 2026");
  assert.equal(formatEventDate("2026-12-31T23:59:59.000Z"), "31 December 2026");
});

// The same string must come out of the server and the browser, or React
// hydration mismatches and a reader in Sydney sees a different date.
test("the date does not shift with the reader's timezone", () => {
  const late = "2026-07-28T23:30:00.000Z";
  assert.equal(formatEventDate(late), "28 July 2026");
  const early = "2026-07-28T00:30:00.000Z";
  assert.equal(formatEventDate(early), "28 July 2026");
});

test("an unparseable timestamp yields null rather than 'Invalid Date'", () => {
  assert.equal(formatEventDate("nonsense"), null);
  assert.equal(formatEventDate(""), null);
});

// ═══ EMPTY STATE ═══
// "No events yet" reads as a bug or an omission. The ledger genuinely begins at
// delivery, so the copy states a fact about the timeline, not an absence of data.
test("the empty state states a fact, not an absence", () => {
  assert.equal(TIMELINE_EMPTY_COPY, "Timeline begins after delivery.");
  assert.doesNotMatch(TIMELINE_EMPTY_COPY, /^No\b/i, "must not open with 'No…'");
  assert.doesNotMatch(TIMELINE_EMPTY_COPY, /empty|none|nothing|yet/i);
});
