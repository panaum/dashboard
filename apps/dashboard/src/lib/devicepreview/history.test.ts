import { test } from "node:test";
import assert from "node:assert/strict";
import { countsOf, deltaLine, deltaOf, deviceRows, verdictLine, type DpReport } from "./history";

const report = (over: Partial<DpReport["summary"]> = {}, devices: DpReport["devices"] = []): DpReport => ({
  schemaVersion: 1, url: "https://x.test/", startedAt: "2026-09-06T00:00:00Z",
  summary: { errors: 0, warnings: 0, infos: 0, devicesPassed: devices.length, devicesWithErrors: [],
             devicesFailed: [], devicesBlocked: [], devicesRegressed: [], ...over },
  devices,
});
const dev = (id: string, findings: { severity: string; rule: string; message: string }[] = [], extra: Partial<DpReport["devices"][number]> = {}) =>
  ({ profile_id: id, label: id, engine: "webkit", platform: "ios", status: "ok", findings, ...extra });

test("worst follows the severity ladder: errors, then regressions, then walls, then warnings", () => {
  assert.equal(countsOf(report({ errors: 1, warnings: 5 }, [dev("a")])).worst, "FAIL");
  assert.equal(countsOf(report({ devicesRegressed: ["a"], warnings: 2 }, [dev("a")])).worst, "REGRESSED");
  assert.equal(countsOf(report({ devicesBlocked: ["a"] }, [dev("a")])).worst, "BLOCKED");
  assert.equal(countsOf(report({ warnings: 3 }, [dev("a")])).worst, "WARN");
  assert.equal(countsOf(report({}, [dev("a")])).worst, "PASS");
});

test("the verdict line reads like the gallery's", () => {
  const r = report({ errors: 2, devicesWithErrors: ["a", "b"] }, [dev("a"), dev("b"), dev("c")]);
  assert.equal(verdictLine(countsOf(r), r), "2 ship-blocking issues on 2 of 3 devices");
  const w = report({ warnings: 1 }, [dev("a")]);
  assert.equal(verdictLine(countsOf(w), w), "No errors · 1 warning to review");
  const clean = report({}, [dev("a"), dev("b")]);
  assert.equal(verdictLine(countsOf(clean), clean), "All 2 devices clean");
  const wall = report({ devicesBlocked: ["a"], devicesFailed: ["b"] }, [dev("a"), dev("b"), dev("c")]);
  assert.equal(verdictLine(countsOf(wall), wall), "Inconclusive — blocked by bot protection on 1, capture failed on 1 of 3 devices");
});

test("delta is current minus previous, and reads in words", () => {
  const prev = countsOf(report({ errors: 3, warnings: 4 }, [dev("a")]));
  const cur = countsOf(report({ errors: 1, warnings: 5 }, [dev("a")]));
  assert.deepEqual(deltaOf(prev, cur), { errors: -2, warnings: 1, regressed: 0 });
  assert.equal(deltaLine(deltaOf(prev, cur)), "2 fewer errors, 1 more warning than the last run.");
  assert.equal(deltaLine(null), "First run for this page.");
  assert.equal(deltaLine(deltaOf(cur, cur)), "Same counts as the last run.");
});

test("device rows sort worst first and carry the worst finding", () => {
  const r = report({}, [
    dev("clean"),
    dev("warned", [{ severity: "warn", rule: "tap-small", message: "small" }, { severity: "info", rule: "image-size", message: "soft" }]),
    dev("broken", [{ severity: "error", rule: "overflow", message: "scrolls sideways" }]),
    dev("walled", [], { status: "blocked", error: "wall" }),
  ]);
  const rows = deviceRows(r);
  assert.deepEqual(rows.map((x) => x.profileId), ["walled", "broken", "warned", "clean"]);
  assert.equal(rows[1].worst?.rule, "overflow");
  assert.equal(rows[2].worst?.severity, "warn");
  assert.equal(rows[3].worst, null);
});
