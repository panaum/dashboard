import { test } from "node:test";
import assert from "node:assert/strict";
import { buildVerification } from "./verification-shape";

const NOW = new Date("2026-08-11T09:30:00.000Z");
const items = (passed: number, failed: number, na = 0) => [
  ...Array.from({ length: passed }, () => ({ result: "PASSED" })),
  ...Array.from({ length: failed }, () => ({ result: "FAILED" })),
  ...Array.from({ length: na }, () => ({ result: "NA" })),
];

// The three shapes below are the REAL production rows, not invented fixtures.

test("Fautons LP — 39 items, 38 passed, 1 failed", () => {
  const v = buildVerification(
    { items: items(38, 1), lastCheckedAt: new Date("2026-08-04T05:29:15.000Z") },
    NOW,
  );
  assert.ok(v);
  assert.equal(v.total, 39);
  assert.equal(v.holding, 38);
  assert.equal(v.needs_attention, 1);
  assert.equal(v.last_checked_at, "2026-08-04T05:29:15.000Z");
});

test("24 Hours AR HubSpot LP — 38 items, 21 passed, 17 failed", () => {
  const v = buildVerification({ items: items(21, 17), lastCheckedAt: null }, NOW);
  assert.ok(v);
  assert.equal(v.holding, 21);
  assert.equal(v.needs_attention, 17);
});

// ═══ THE CASE THIS MODULE EXISTS FOR ═══
// Imported pages have every item N/A because QA was tracked at the verdict
// level, not per check. "0 checks holding" would be false and alarming.
test("an ungraded checklist renders nothing rather than zero", () => {
  assert.equal(buildVerification({ items: items(0, 0, 38), lastCheckedAt: null }, NOW), null);
});

test("a page with no certificate items renders nothing", () => {
  assert.equal(buildVerification({ items: [], lastCheckedAt: null }, NOW), null);
});

test("unset results count as ungraded, not as failures", () => {
  const v = buildVerification({ items: [{ result: null }, { result: null }], lastCheckedAt: null }, NOW);
  assert.equal(v, null);
});

// A single graded item is enough to have something honest to say.
test("one graded item is enough to render", () => {
  const v = buildVerification({ items: items(1, 0, 37), lastCheckedAt: null }, NOW);
  assert.ok(v);
  assert.equal(v.holding, 1);
  assert.equal(v.total, 38, "total counts every item, including the ungraded ones");
});

// All-failing is still reportable — hiding it would be flattering, not honest.
test("an all-failing checklist is reported, not hidden", () => {
  const v = buildVerification({ items: items(0, 5), lastCheckedAt: null }, NOW);
  assert.ok(v);
  assert.equal(v.holding, 0);
  assert.equal(v.needs_attention, 5);
});

test("never checked yields a null timestamp, not a fabricated one", () => {
  const v = buildVerification({ items: items(3, 0), lastCheckedAt: null }, NOW);
  assert.ok(v);
  assert.equal(v.last_checked_at, null);
});

test("an invalid timestamp is treated as never checked", () => {
  const v = buildVerification({ items: items(3, 0), lastCheckedAt: new Date("nope") }, NOW);
  assert.ok(v);
  assert.equal(v.last_checked_at, null);
});

test("garbage input never throws", () => {
  assert.doesNotThrow(() =>
    buildVerification({ items: null as never, lastCheckedAt: null }, NOW),
  );
});

test("is deterministic", () => {
  const src = { items: items(38, 1), lastCheckedAt: new Date("2026-08-04T05:29:15.000Z") };
  assert.deepEqual(buildVerification(src, NOW), buildVerification(src, NOW));
});
