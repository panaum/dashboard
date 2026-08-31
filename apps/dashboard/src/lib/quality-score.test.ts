import { test } from "node:test";
import assert from "node:assert/strict";
import { scorePage, aggregateScore } from "./quality-score";

const PASS = { result: "PASSED" as const };
const FAIL = { result: "FAILED" as const };
const NA = { result: "NA" as const };

test("perfect deliverable scores 100 and reads excellent", () => {
  const r = scorePage({
    certStatus: "PASS",
    items: [PASS, PASS, PASS],
    issues: [],
    delayDays: 0,
  });
  assert.equal(r.score, 100);
  assert.equal(r.band, "excellent");
  assert.equal(r.provisional, false);
});

test("ungraded, in-progress deliverable is provisional, not perfect", () => {
  const r = scorePage({
    certStatus: "IN_PROGRESS",
    items: [NA, NA],
    issues: [],
    delayDays: 0,
  });
  assert.equal(r.provisional, true);
  assert.equal(r.band, "pending");
});

test("failed checks lower the score proportionally", () => {
  const r = scorePage({
    certStatus: "PASS",
    items: [PASS, PASS, FAIL, FAIL], // 50% fail rate → −20
    issues: [],
    delayDays: 0,
  });
  assert.equal(r.score, 80);
});

test("open issues are penalised by severity and forgiven when fixed", () => {
  const open = scorePage({
    certStatus: "PASS",
    items: [PASS, PASS],
    issues: [{ severity: "CRITICAL_HIGH", status: "OPEN" }],
    delayDays: 0,
  });
  const fixed = scorePage({
    certStatus: "PASS",
    items: [PASS, PASS],
    issues: [{ severity: "CRITICAL_HIGH", status: "FIXED" }],
    delayDays: 0,
  });
  assert.equal(open.score, 86); // 100 − 14
  assert.equal(fixed.score, 100); // fixed issues don't penalise
});

test("issue penalty is capped so issues alone can't zero a page", () => {
  const r = scorePage({
    certStatus: "IN_PROGRESS", // no verdict floor, so the cap is observable
    items: [PASS],
    issues: Array.from({ length: 20 }, () => ({
      severity: "CRITICAL_HIGH",
      status: "OPEN",
    })),
    delayDays: 0,
  });
  assert.equal(r.score, 55); // 100 − 45 cap
});

test("a FAILED certificate is capped below passing", () => {
  const r = scorePage({
    certStatus: "FAIL",
    items: [PASS, PASS, PASS],
    issues: [],
    delayDays: 0,
  });
  assert.ok(r.score <= 55);
  assert.equal(r.band, "fair");
});

test("lateness lowers the score, capped", () => {
  const small = scorePage({ certStatus: "PASS", items: [PASS], issues: [], delayDays: 2 });
  const huge = scorePage({ certStatus: "PASS", items: [PASS], issues: [], delayDays: 100 });
  assert.equal(small.score, 97); // −3
  assert.equal(huge.score, 85); // −15 cap
});

test("aggregateScore averages only reviewed deliverables", () => {
  const a = scorePage({ certStatus: "PASS", items: [PASS, PASS], issues: [], delayDays: 0 });
  const b = scorePage({ certStatus: "PASS", items: [PASS, FAIL], issues: [], delayDays: 0 }); // 80
  const pending = scorePage({ certStatus: "IN_PROGRESS", items: [NA], issues: [], delayDays: 0 });
  const agg = aggregateScore([a, b, pending]);
  assert.equal(agg.score, 90); // (100 + 80) / 2, pending excluded
  assert.equal(agg.provisional, false);
});

test("aggregateScore is provisional when nothing is reviewed", () => {
  const pending = scorePage({ certStatus: "IN_PROGRESS", items: [NA], issues: [], delayDays: 0 });
  assert.equal(aggregateScore([pending]).provisional, true);
});
