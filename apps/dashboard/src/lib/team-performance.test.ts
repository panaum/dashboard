import test from "node:test";
import assert from "node:assert/strict";
import {
  computeTeamPerformance,
  metricValue,
  rollingMonths,
  sortForMetric,
  thinSamples,
  windowLabel,
  type TeamPerfPage,
} from "./team-performance";
import { monthLabel } from "./constants";

const dev = (id: string, name: string) => ({ id, name });

const page = (over: Partial<TeamPerfPage> = {}): TeamPerfPage => ({
  delayDays: 0,
  developer: dev("d1", "Ada"),
  issues: [],
  ...over,
});

const issues = (...statuses: string[]) => statuses.map((status) => ({ status }));

test("aggregates pages, fixed issues and delay per developer", () => {
  const r = computeTeamPerformance([
    page({ delayDays: 0, issues: issues("FIXED", "OPEN") }),
    page({ delayDays: 4, issues: issues("FIXED") }),
    page({ developer: dev("d2", "Bo"), delayDays: 0, issues: issues("FIXED", "FIXED") }),
  ]);

  const ada = r.devs.find((d) => d.id === "d1")!;
  assert.equal(ada.pages, 2);
  assert.equal(ada.issuesDone, 2); // OPEN is not counted
  assert.equal(ada.delayDays, 4);
  assert.equal(ada.onTimePct, 50); // 1 of 2 pages on time

  const bo = r.devs.find((d) => d.id === "d2")!;
  assert.equal(bo.pages, 1);
  assert.equal(bo.issuesDone, 2);
  assert.equal(bo.onTimePct, 100);
});

test("totals are org-wide, not a mean of the per-developer rates", () => {
  // Ada: 1 of 3 on time. Bo: 1 of 1. Org-wide = 2 of 4 = 50%,
  // while the mean of the two rates would be 67%.
  const r = computeTeamPerformance([
    page({ delayDays: 0 }),
    page({ delayDays: 2 }),
    page({ delayDays: 2 }),
    page({ developer: dev("d2", "Bo"), delayDays: 0 }),
  ]);
  assert.equal(r.totals.onTimePct, 50);
  assert.equal(r.totals.pages, 4);
  assert.equal(r.totals.developers, 2);
  assert.equal(Math.round(r.averages.onTime), 67);
});

test("pages with no developer count for nobody", () => {
  const r = computeTeamPerformance([
    page({ developer: null, delayDays: 9, issues: issues("FIXED") }),
    page({ delayDays: 0 }),
  ]);
  assert.equal(r.devs.length, 1);
  assert.equal(r.totals.pages, 1);
  assert.equal(r.totals.delayDays, 0);
  assert.equal(r.totals.issuesDone, 0);
});

test("empty input yields zeros, never NaN", () => {
  const r = computeTeamPerformance([]);
  assert.deepEqual(r.devs, []);
  assert.equal(r.totals.onTimePct, 0);
  assert.equal(r.totals.pages, 0);
  assert.equal(r.averages.onTime, 0);
  assert.equal(r.averages.delay, 0);
  assert.equal(r.delayRecorded, false);
});

test("delayDays of exactly 0 is on time, and negative (early) is too", () => {
  const r = computeTeamPerformance([page({ delayDays: 0 }), page({ delayDays: -3 })]);
  assert.equal(r.devs[0].onTimePct, 100);
  assert.equal(r.delayRecorded, false); // nothing late anywhere
});

test("delayRecorded flags whether the delay column was filled in at all", () => {
  assert.equal(computeTeamPerformance([page({ delayDays: 0 })]).delayRecorded, false);
  assert.equal(computeTeamPerformance([page({ delayDays: 1 })]).delayRecorded, true);
});

test("sortForMetric puts the worst first for on-time and delay", () => {
  const r = computeTeamPerformance([
    page({ delayDays: 0 }), // Ada: 100% on time, 0 delay
    page({ developer: dev("d2", "Bo"), delayDays: 6 }), // Bo: 0%, 6 days
  ]);
  assert.deepEqual(sortForMetric(r.devs, "onTime").map((d) => d.name), ["Bo", "Ada"]);
  assert.deepEqual(sortForMetric(r.devs, "delay").map((d) => d.name), ["Bo", "Ada"]);
  // Volume metrics rank busiest first.
  assert.deepEqual(sortForMetric(r.devs, "pages").map((d) => d.name), ["Ada", "Bo"]);
});

test("sortForMetric breaks ties by name, so the order never jitters", () => {
  const r = computeTeamPerformance([
    page({ developer: dev("d2", "Bo") }),
    page({ developer: dev("d1", "Ada") }),
    page({ developer: dev("d3", "Cy") }),
  ]);
  assert.deepEqual(sortForMetric(r.devs, "onTime").map((d) => d.name), ["Ada", "Bo", "Cy"]);
});

test("defect rate counts every issue, not only the fixed ones", () => {
  const r = computeTeamPerformance([
    page({ issues: issues("FIXED", "OPEN") }),
    page({ issues: issues("OPEN") }),
  ]);
  const d = r.devs[0];
  assert.equal(d.issuesDone, 1); // only FIXED
  assert.equal(d.issuesTotal, 3); // fixed + open
  assert.equal(d.issuesPerPage, 1.5); // 3 issues / 2 pages
});

test("defect rate ranks worst (highest) first", () => {
  const r = computeTeamPerformance([
    page({ issues: issues("OPEN") }), // Ada: 1.0 / page
    page({ developer: dev("d2", "Bo"), issues: issues("OPEN", "FIXED", "OPEN") }), // Bo: 3.0
  ]);
  assert.deepEqual(sortForMetric(r.devs, "defects").map((d) => d.name), ["Bo", "Ada"]);
  assert.equal(r.averages.defects, 2); // mean of 1.0 and 3.0
});

test("a developer with no issues has a defect rate of 0, not NaN", () => {
  const r = computeTeamPerformance([page({ issues: [] })]);
  assert.equal(r.devs[0].issuesPerPage, 0);
});

test("thinSamples names developers below the ranking floor", () => {
  const r = computeTeamPerformance([
    page({ developer: dev("d1", "Ada") }),
    page({ developer: dev("d2", "Bo") }),
    page({ developer: dev("d2", "Bo") }),
    page({ developer: dev("d2", "Bo") }),
  ]);
  assert.deepEqual(thinSamples(r.devs).map((d) => d.name), ["Ada"]); // 1 page < 3
});

test("metricValue reads the field each metric plots", () => {
  const d = computeTeamPerformance([
    page({ delayDays: 3, issues: issues("FIXED") }),
  ]).devs[0];
  assert.equal(metricValue(d, "pages"), 1);
  assert.equal(metricValue(d, "issues"), 1);
  assert.equal(metricValue(d, "delay"), 3);
  assert.equal(metricValue(d, "defects"), 1);
  assert.equal(metricValue(d, "onTime"), 0);
});

test("rollingMonths takes the newest months, oldest first", () => {
  const all = ["2026-01", "2026-08", "2026-06", "2026-07", "2026-03"];
  assert.deepEqual(rollingMonths(all, 3), ["2026-06", "2026-07", "2026-08"]);
});

test("rollingMonths dedupes and copes with fewer months than asked for", () => {
  assert.deepEqual(rollingMonths(["2026-02", "2026-02"], 3), ["2026-02"]);
  assert.deepEqual(rollingMonths([], 3), []);
});

test("windowLabel collapses a same-year range", () => {
  assert.equal(windowLabel(["2026-06", "2026-07", "2026-08"], monthLabel), "June–August 2026");
  assert.equal(windowLabel(["2026-08"], monthLabel), "August 2026");
  assert.equal(windowLabel(["2025-12", "2026-01"], monthLabel), "December 2025 – January 2026");
  assert.equal(windowLabel([], monthLabel), "No delivery months");
});
