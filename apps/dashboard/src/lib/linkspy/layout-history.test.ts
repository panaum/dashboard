import { test } from "node:test";
import assert from "node:assert/strict";

import { type RunSummary, diffRuns, verdictOf } from "./layout-history";
import type { ResponsiveFinding } from "./responsive-view";

const f = (id: string, status: ResponsiveFinding["status"]): ResponsiveFinding => ({
  id, status, title: id,
});
const run = (at: string, ...fs: ResponsiveFinding[]): RunSummary => ({ checkedAt: at, findings: fs });

test("a failure that became a pass is fixed", () => {
  const d = diffRuns(run("t1", f("overflow", "FAIL")), run("t2", f("overflow", "PASS")));
  assert.equal(d[0].movement, "fixed");
  assert.equal(d[0].before, "FAIL");
  assert.equal(d[0].after, "PASS");
});

test("a pass that became a failure is a regression, and sorts first", () => {
  const d = diffRuns(
    run("t1", f("overflow", "PASS"), f("edge", "FAIL")),
    run("t2", f("overflow", "FAIL"), f("edge", "FAIL")),
  );
  assert.equal(d[0].id, "overflow");
  assert.equal(d[0].movement, "introduced");
});

test("a warning still present is still open, not fixed", () => {
  const d = diffRuns(run("t1", f("clipped", "WARN")), run("t2", f("clipped", "WARN")));
  assert.equal(d[0].movement, "still-open");
});

test("FAIL downgraded to WARN is still open — it is not repaired", () => {
  const d = diffRuns(run("t1", f("overflow", "FAIL")), run("t2", f("overflow", "WARN")));
  assert.equal(d[0].movement, "still-open");
});

test("a page that stopped loading is not counted as fixed", () => {
  const d = diffRuns(run("t1", f("overflow", "FAIL")), run("t2", f("overflow", "SKIP")));
  assert.equal(d[0].movement, "still-open");
});

test("with no previous run nothing counts as introduced", () => {
  const d = diffRuns(null, run("t1", f("overflow", "FAIL"), f("edge", "PASS")));
  assert.deepEqual(d.map((c) => c.movement).sort(), ["still-open", "unchanged"]);
});

test("a finding present in only one run is still reported", () => {
  const d = diffRuns(run("t1", f("overflow", "FAIL")), run("t2", f("edge", "WARN")));
  const byId = Object.fromEntries(d.map((c) => [c.id, c]));
  assert.equal(byId.overflow.after, null);
  assert.equal(byId.overflow.movement, "fixed");
  assert.equal(byId.edge.before, null);
  assert.equal(byId.edge.movement, "introduced");
});

// ── the verdict someone reads before accepting a developer's fix ───────────

test("a regression leads the verdict even when something was fixed", () => {
  const changes = diffRuns(
    run("t1", f("overflow", "FAIL"), f("edge", "PASS")),
    run("t2", f("overflow", "PASS"), f("edge", "FAIL")),
  );
  const v = verdictOf(changes, true);
  assert.equal(v.tone, "error");
  assert.equal(v.introduced, 1);
  assert.equal(v.fixed, 1);
  assert.match(v.headline, /new problem/);
  assert.match(v.headline, /1 was fixed/);
});

test("everything fixed and nothing left reads as success", () => {
  const v = verdictOf(diffRuns(run("t1", f("overflow", "FAIL")), run("t2", f("overflow", "PASS"))), true);
  assert.equal(v.tone, "success");
  assert.match(v.headline, /1 fixed, nothing left open/);
});

test("a partial fix says so", () => {
  const v = verdictOf(diffRuns(
    run("t1", f("overflow", "FAIL"), f("edge", "WARN")),
    run("t2", f("overflow", "PASS"), f("edge", "WARN")),
  ), true);
  assert.equal(v.tone, "warning");
  assert.match(v.headline, /1 fixed, 1 still open/);
});

test("no movement at all says nothing changed", () => {
  const v = verdictOf(diffRuns(run("t1", f("edge", "WARN")), run("t2", f("edge", "WARN"))), true);
  assert.match(v.headline, /Nothing changed/);
});

test("a first check is never described as a regression", () => {
  const v = verdictOf(diffRuns(null, run("t1", f("overflow", "FAIL"))), false);
  assert.equal(v.introduced, 0);
  assert.match(v.headline, /First check/);
});
