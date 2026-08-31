import { test } from "node:test";
import assert from "node:assert/strict";
import { computeInsights, type InsightPage } from "./insights";

/** Build a page with sensible defaults; override only what a test cares about. */
function page(over: Partial<InsightPage> = {}): InsightPage {
  return {
    delayDays: 0,
    deliveryMonth: "2026-01",
    developer: { id: "d1", name: "Dev One" },
    project: { platform: "WORDPRESS" },
    issues: [],
    ...over,
  };
}

const issues = (...sev: string[]) => sev.map((severity) => ({ severity }));

// ─── Normal values ──────────────────────────────────────────────────────────

test("normal: aggregates totals, averages and on-time percentage", () => {
  const pages = [
    page({ delayDays: 0, issues: issues("LOW", "MEDIUM") }), // on time, 2 issues
    page({ delayDays: 3, issues: issues("CRITICAL_HIGH") }), // late, 1 issue
    page({ delayDays: -2, issues: [] }), // early, 0 issues
    page({ delayDays: 5, issues: issues("REPETITIVE", "LOW") }), // late, 2 issues
  ];

  const r = computeInsights(pages);

  assert.equal(r.total, 4);
  assert.equal(r.totalIssues, 5);
  assert.equal(r.avgIssues, 1.25); // 5 / 4
  assert.equal(r.repetitive, 1);
  // delayDays <= 0 for 2 of 4 pages → 50%
  assert.equal(r.onTimePct, 50);
});

test("normal: platforms ranked noisiest-first, min 3 pages, cleanest last", () => {
  const pages = [
    // WORDPRESS: 3 pages, 6 issues → avg 2.0
    page({ project: { platform: "WORDPRESS" }, issues: issues("LOW", "LOW") }),
    page({ project: { platform: "WORDPRESS" }, issues: issues("LOW", "LOW") }),
    page({ project: { platform: "WORDPRESS" }, issues: issues("LOW", "LOW") }),
    // WEBFLOW: 3 pages, 3 issues → avg 1.0
    page({ project: { platform: "WEBFLOW" }, issues: issues("LOW") }),
    page({ project: { platform: "WEBFLOW" }, issues: issues("LOW") }),
    page({ project: { platform: "WEBFLOW" }, issues: issues("LOW") }),
    // WIX: only 2 pages → excluded by MIN_SAMPLE
    page({ project: { platform: "WIX" }, issues: issues("LOW") }),
    page({ project: { platform: "WIX" }, issues: issues("LOW") }),
  ];

  const r = computeInsights(pages);

  assert.deepEqual(
    r.platforms.map((p) => p.platform),
    ["WORDPRESS", "WEBFLOW"], // noisiest first; WIX dropped (< 3)
  );
  assert.equal(r.platforms[0].avg, 2);
  assert.equal(r.platforms[1].avg, 1);
  assert.equal(r.maxPlatAvg, 2);
});

test("normal: developers ranked by lowest defect rate, min 3 builds", () => {
  const pages = [
    // Ana: 3 builds, 3 issues → avg 1.0
    page({ developer: { id: "ana", name: "Ana" }, issues: issues("LOW") }),
    page({ developer: { id: "ana", name: "Ana" }, issues: issues("LOW") }),
    page({ developer: { id: "ana", name: "Ana" }, issues: issues("LOW") }),
    // Ben: 3 builds, 9 issues → avg 3.0
    page({ developer: { id: "ben", name: "Ben" }, issues: issues("LOW", "LOW", "LOW") }),
    page({ developer: { id: "ben", name: "Ben" }, issues: issues("LOW", "LOW", "LOW") }),
    page({ developer: { id: "ben", name: "Ben" }, issues: issues("LOW", "LOW", "LOW") }),
    // Cara: 2 builds → excluded
    page({ developer: { id: "cara", name: "Cara" }, issues: [] }),
    page({ developer: { id: "cara", name: "Cara" }, issues: [] }),
  ];

  const r = computeInsights(pages);

  assert.deepEqual(
    r.devs.map((d) => d.name),
    ["Ana", "Ben"], // lowest avg first; Cara dropped (< 3 builds)
  );
  assert.equal(r.devs[0].avg, 1);
  assert.equal(r.devs[1].avg, 3);
});

test("normal: months sorted chronologically via lexical compare", () => {
  const pages = [
    page({ deliveryMonth: "2026-03", issues: issues("LOW", "LOW") }), // avg 2
    page({ deliveryMonth: "2026-01", issues: issues("LOW") }), // avg 1
    page({ deliveryMonth: "2026-02", issues: [] }), // avg 0
  ];

  const r = computeInsights(pages);

  assert.deepEqual(
    r.months.map((m) => m.m),
    ["2026-01", "2026-02", "2026-03"],
  );
  assert.deepEqual(
    r.months.map((m) => m.avg),
    [1, 0, 2],
  );
  assert.equal(r.maxMonthAvg, 2);
});

// ─── Zero ───────────────────────────────────────────────────────────────────

test("zero: pages with no issues yield zero averages, not NaN", () => {
  const pages = [
    page({ issues: [] }),
    page({ issues: [] }),
    page({ issues: [] }),
  ];

  const r = computeInsights(pages);

  assert.equal(r.totalIssues, 0);
  assert.equal(r.avgIssues, 0);
  assert.equal(r.repetitive, 0);
  assert.equal(r.onTimePct, 100); // all delayDays 0 → on time
  assert.equal(r.platforms[0].avg, 0);
  // denominators clamp to 1 so a zero-issue dataset can't divide by zero.
  assert.equal(r.maxPlatAvg, 1);
  assert.equal(r.maxMonthAvg, 1);
});

test("zero: delayDays exactly 0 counts as on time (boundary)", () => {
  const r = computeInsights([page({ delayDays: 0 })]);
  assert.equal(r.onTimePct, 100);
});

// ─── Negative numbers ─────────────────────────────────────────────────────────

test("negative: early deliveries (delayDays < 0) count as on time", () => {
  const pages = [
    page({ delayDays: -5 }),
    page({ delayDays: -1 }),
    page({ delayDays: 4 }), // the only late one
  ];

  const r = computeInsights(pages);

  // 2 of 3 delivered early/on time → round(66.67) = 67
  assert.equal(r.onTimePct, 67);
});

test("negative: all early still caps at 100%, never above", () => {
  const r = computeInsights([
    page({ delayDays: -10 }),
    page({ delayDays: -3 }),
  ]);
  assert.equal(r.onTimePct, 100);
});

// ─── Division by zero / empty sets ────────────────────────────────────────────

test("empty: no pages returns zeroed result without NaN or throwing", () => {
  const r = computeInsights([]);

  assert.equal(r.total, 0);
  assert.equal(r.totalIssues, 0);
  assert.equal(r.avgIssues, 0); // guarded against 0/0
  assert.equal(r.repetitive, 0);
  assert.equal(r.onTimePct, 0); // guarded against 0/0
  assert.deepEqual(r.platforms, []);
  assert.deepEqual(r.devs, []);
  assert.deepEqual(r.months, []);
  // Math.max(1, ...[]) — clamps so bar charts never divide by zero.
  assert.equal(r.maxPlatAvg, 1);
  assert.equal(r.maxMonthAvg, 1);

  // explicit: nothing is NaN
  assert.ok(!Number.isNaN(r.avgIssues));
  assert.ok(!Number.isNaN(r.onTimePct));
  assert.ok(!Number.isNaN(r.maxPlatAvg));
  assert.ok(!Number.isNaN(r.maxMonthAvg));
});

test("empty: null developer and null deliveryMonth are skipped, not counted", () => {
  const pages = [
    page({ developer: null, deliveryMonth: null, issues: issues("LOW") }),
    page({ developer: null, deliveryMonth: null, issues: [] }),
  ];

  const r = computeInsights(pages);

  assert.equal(r.total, 2); // pages still counted toward totals
  assert.equal(r.totalIssues, 1);
  assert.deepEqual(r.devs, []); // no developer → no leaderboard rows
  assert.deepEqual(r.months, []); // no month → no trend rows
  assert.equal(r.maxMonthAvg, 1); // still safe
});

test("empty: fewer than the minimum sample drops the group entirely", () => {
  const pages = [
    page({ project: { platform: "WIX" }, developer: { id: "x", name: "X" } }),
    page({ project: { platform: "WIX" }, developer: { id: "x", name: "X" } }),
  ];

  const r = computeInsights(pages); // only 2 of each → below MIN_SAMPLE of 3

  assert.deepEqual(r.platforms, []);
  assert.deepEqual(r.devs, []);
  assert.equal(r.maxPlatAvg, 1);
});
