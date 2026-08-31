import { test } from "node:test";
import assert from "node:assert/strict";
import {
  holdingLine,
  attentionLine,
  lastCheckedLine,
  verificationClauses,
} from "./verification.ts";
import type { Verification } from "./living-certificate.ts";

const NOW = new Date("2026-08-11T09:30:00.000Z");
const v = (over: Partial<Verification> = {}): Verification => ({
  total: 39,
  holding: 38,
  needs_attention: 1,
  last_checked_at: "2026-08-04T05:29:15.000Z",
  ...over,
});

// Fautons LP, exactly as it stands in production.
test("the real Fautons LP line", () => {
  assert.deepEqual(verificationClauses(v(), NOW), [
    "38 of 39 checks holding",
    "1 needs attention",
    "last checked 7 days ago",
  ]);
});

// ═══ NEVER FLATTER THE RESULT ═══
// The denominator and the failure are on the same line as the win.
test("the failing check is always stated alongside the holding count", () => {
  const clauses = verificationClauses(v(), NOW);
  assert.ok(clauses.some((c) => c.includes("needs attention")), "a failure must be visible");
  assert.ok(clauses[0].includes("of 39"), "the denominator must be shown, not just the wins");
});

test("attention is omitted only when nothing is failing", () => {
  assert.equal(attentionLine(v({ needs_attention: 0 })), null);
  assert.equal(attentionLine(v({ needs_attention: 1 })), "1 needs attention");
  assert.equal(attentionLine(v({ needs_attention: 17 })), "17 need attention");
});

test("an all-holding page reads cleanly", () => {
  assert.deepEqual(verificationClauses(v({ total: 39, holding: 39, needs_attention: 0 }), NOW), [
    "39 of 39 checks holding",
    "last checked 7 days ago",
  ]);
});

test("singular check", () => {
  assert.equal(holdingLine(v({ total: 1, holding: 1, needs_attention: 0 })), "1 of 1 check holding");
});

// ═══ RELATIVE TIME ═══
test("relative time is coarse and correct", () => {
  const at = (iso: string) => lastCheckedLine(v({ last_checked_at: iso }), NOW);
  assert.equal(at("2026-08-11T09:29:30.000Z"), "last checked just now");
  assert.equal(at("2026-08-11T09:00:00.000Z"), "last checked 30 minutes ago");
  assert.equal(at("2026-08-11T05:30:00.000Z"), "last checked 4 hours ago");
  assert.equal(at("2026-08-11T08:30:00.000Z"), "last checked 1 hour ago");
  assert.equal(at("2026-08-10T09:00:00.000Z"), "last checked 1 day ago");
  assert.equal(at("2026-08-04T05:29:15.000Z"), "last checked 7 days ago");
});

// Never checked must read as absent, not as "just now".
test("a null timestamp yields no clause at all", () => {
  assert.equal(lastCheckedLine(v({ last_checked_at: null }), NOW), null);
  assert.deepEqual(verificationClauses(v({ last_checked_at: null, needs_attention: 0 }), NOW), [
    "38 of 39 checks holding",
  ]);
});

test("an unparseable timestamp yields no clause rather than NaN", () => {
  assert.equal(lastCheckedLine(v({ last_checked_at: "not-a-date" }), NOW), null);
});

// Clock skew between the Dashboard and the shell must not produce "in 3 hours".
test("a future timestamp never reads as the future", () => {
  assert.equal(lastCheckedLine(v({ last_checked_at: "2026-08-11T12:00:00.000Z" }), NOW), "last checked just now");
});

test("is deterministic", () => {
  assert.deepEqual(verificationClauses(v(), NOW), verificationClauses(v(), NOW));
});
