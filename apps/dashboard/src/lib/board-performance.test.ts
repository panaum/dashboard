import test from "node:test";
import assert from "node:assert/strict";

import { computeBoardPerformance, monthPeriod } from "./board-performance";
import type { BoardEvent, BoardIssue } from "./board-performance";

const SEP = monthPeriod("2026-09");
// Fixtures are UTC. A bare "2026-10-01T00:00" parses as LOCAL time, and on a
// UTC+5:30 machine that is still 30 September in UTC — which is exactly the
// kind of bug this period test exists to catch, so the fixture must not have it.
const at = (d: string) => new Date(/[zZ]|[+-]\d\d:\d\d$/.test(d) ? d : `${d}Z`).toISOString();

const issues: BoardIssue[] = [
  { id: "i1", assigneeId: "dev1", recurring: false, createdAt: at("2026-09-02") },
  { id: "i2", assigneeId: "dev1", recurring: true, createdAt: at("2026-09-05") },
  { id: "i3", assigneeId: "dev2", recurring: false, createdAt: at("2026-09-10") },
  { id: "old", assigneeId: "dev1", recurring: true, createdAt: at("2026-08-20") }, // last month
  { id: "nobody", assigneeId: null, recurring: false, createdAt: at("2026-09-12") },
];

const ev = (issueId: string, from: BoardEvent["fromStage"], to: BoardEvent["toStage"], when: string, actorId = "x"): BoardEvent =>
  ({ issueId, fromStage: from, toStage: to, actorId, createdAt: at(when) });

const events: BoardEvent[] = [
  ev("i1", null, "NEW", "2026-09-02T09:00"),
  ev("i1", "NEW", "ACTIVE", "2026-09-02T10:00"),
  ev("i1", "ACTIVE", "COMPLETED", "2026-09-03T09:00"),      // 24h cycle
  ev("i1", "COMPLETED", "ACTIVE", "2026-09-03T12:00"),      // bounce-back
  ev("i1", "ACTIVE", "COMPLETED", "2026-09-04T09:00"),      // second completion: not counted twice
  ev("i1", "COMPLETED", "CLOSED", "2026-09-04T15:00"),
  ev("i2", null, "NEW", "2026-09-05T09:00"),
  ev("i2", "NEW", "ACTIVE", "2026-09-05T09:30"),
  ev("i2", "ACTIVE", "COMPLETED", "2026-09-07T09:00"),      // 48h cycle
  ev("i3", null, "NEW", "2026-09-10T09:00"),
  ev("old", "COMPLETED", "CLOSED", "2026-09-01T09:00"),     // closed this month, assigned last month
  ev("old", "CLOSED", "ACTIVE", "2026-09-15T09:00"),        // bounce-back this month
];

test("assigned counts cards created in the period, per developer", () => {
  const p = computeBoardPerformance(issues, events, SEP);
  const dev1 = p.devs.find((d) => d.id === "dev1")!;
  assert.equal(dev1.assigned, 2, "i1 and i2; 'old' was assigned in August");
  assert.equal(dev1.recurring, 1, "i2 only — 'old' is recurring but not this period");
  assert.equal(p.devs.find((d) => d.id === "dev2")!.assigned, 1);
});

test("an unassigned card counts for nobody", () => {
  const p = computeBoardPerformance(issues, events, SEP);
  assert.ok(!p.devs.some((d) => d.id === "null" || d.id === ""));
  assert.equal(p.totals.assigned, 3);
});

test("closed counts closures in the period even for cards assigned earlier", () => {
  const dev1 = computeBoardPerformance(issues, events, SEP).devs.find((d) => d.id === "dev1")!;
  assert.equal(dev1.closed, 2, "i1 and 'old' both closed in September");
});

test("cycle time is first NEW to first COMPLETED, averaged, in hours", () => {
  const dev1 = computeBoardPerformance(issues, events, SEP).devs.find((d) => d.id === "dev1")!;
  assert.equal(dev1.completed, 2, "i1 once (its second completion is a re-do), i2 once");
  assert.equal(dev1.cycleHours, 36, "(24 + 48) / 2");
  const dev2 = computeBoardPerformance(issues, events, SEP).devs.find((d) => d.id === "dev2")!;
  assert.equal(dev2.cycleHours, null, "nothing completed — no number rather than 0");
});

test("bounce-backs are attributed to the card's developer, not to whoever moved it", () => {
  const dev1 = computeBoardPerformance(issues, events, SEP).devs.find((d) => d.id === "dev1")!;
  assert.equal(dev1.bounceBacks, 2, "i1 from COMPLETED, 'old' from CLOSED");
  assert.equal(computeBoardPerformance(issues, events, SEP).totals.bounceBacks, 2);
});

test("the period is half-open, so the first of next month is not this month", () => {
  const oct = computeBoardPerformance(issues, [ev("i1", "NEW", "CLOSED", "2026-10-01T00:00")], monthPeriod("2026-09"));
  assert.equal(oct.totals.closed, 0);
  const p = monthPeriod("2026-09");
  assert.equal(new Date(p.from).toISOString(), "2026-09-01T00:00:00.000Z");
  assert.equal(new Date(p.to).toISOString(), "2026-10-01T00:00:00.000Z");
});

test("no events and no issues is an empty panel, not a crash", () => {
  assert.deepEqual(computeBoardPerformance([], [], SEP),
    { devs: [], totals: { assigned: 0, closed: 0, bounceBacks: 0 } });
});
