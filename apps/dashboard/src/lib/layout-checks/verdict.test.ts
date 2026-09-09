import { test } from "node:test";
import assert from "node:assert/strict";
import { agoWords, compareLine, devicesVerdict, viewportsVerdict } from "./verdict";
import type { DpReport } from "@/lib/devicepreview/history";

const NOW = Date.parse("2026-09-07T12:00:00Z");
const at = (hoursAgo: number) => new Date(NOW - hoursAgo * 3600_000).toISOString();

const report = (over: Partial<DpReport["summary"]> = {}, devices = 14): DpReport => ({
  schemaVersion: 1, url: "https://x.test/", startedAt: at(0),
  summary: { errors: 0, warnings: 0, infos: 0, devicesPassed: devices, devicesWithErrors: [], devicesFailed: [], devicesBlocked: [], devicesRegressed: [], ...over },
  devices: Array.from({ length: devices }, (_, i) => ({ profile_id: `d${i}`, label: `d${i}`, engine: "webkit", platform: "ios", status: "ok", findings: [] })),
});

test("time reads in words", () => {
  assert.equal(agoWords(at(0), NOW), "just now");
  assert.equal(agoWords(at(4), NOW), "4 hours ago");
  assert.equal(agoWords(at(1), NOW), "1 hour ago");
  assert.equal(agoWords(new Date(NOW - 5 * 60_000).toISOString(), NOW), "5 minutes ago");
  assert.equal(agoWords(at(72), NOW), "3 days ago");
});

test("the compare line counts errors when either run has any, otherwise warnings", () => {
  assert.equal(compareLine({ errors: 1, warnings: 9, checkedAt: at(0) }, { errors: 2, warnings: 3, checkedAt: at(4) }, NOW), "1 fewer than the last run, 4 hours ago");
  assert.equal(compareLine({ errors: 0, warnings: 5, checkedAt: at(0) }, { errors: 0, warnings: 3, checkedAt: at(4) }, NOW), "2 warnings more than the last run, 4 hours ago");
  assert.equal(compareLine({ errors: 0, warnings: 3, checkedAt: at(0) }, { errors: 0, warnings: 3, checkedAt: at(1) }, NOW), "Same as the last run, 1 hour ago");
  assert.equal(compareLine({ errors: 0, warnings: 0, checkedAt: at(0) }, null, NOW), null);
});

test("devices: the most common outcome is the shortest to read", () => {
  const clean = devicesVerdict({ report: report(), checkedAt: at(0) }, null, NOW);
  assert.deepEqual(clean, { headline: "Clean across all 14 devices", tone: "success", compare: null });
  const broken = devicesVerdict({ report: report({ errors: 2, devicesWithErrors: ["a", "b"] }), checkedAt: at(0) },
                                { report: report({ errors: 3, devicesWithErrors: ["a", "b", "c"] }), checkedAt: at(4) }, NOW);
  assert.equal(broken.headline, "2 ship-blocking issues on 2 of 14 devices");
  assert.equal(broken.tone, "error");
  assert.equal(broken.compare, "1 fewer than the last run, 4 hours ago");
  assert.equal(devicesVerdict({ report: report({ warnings: 21 }), checkedAt: at(0) }, null, NOW).headline, "No breaks · 21 warnings to review across 14 devices");
  assert.equal(devicesVerdict({ report: report({ devicesBlocked: ["a"] }), checkedAt: at(0) }, null, NOW).tone, "neutral");
  assert.equal(devicesVerdict(null, null, NOW).headline, "Not run yet");
});

test("viewports: same shape, its own words", () => {
  const f = (status: "FAIL" | "WARN" | "PASS" | "SKIP", id: string) => ({ id, status, title: id });
  const widths = [350, 375, 425, 450, 470, 768, 1024, 1440];
  assert.equal(viewportsVerdict({ findings: [f("PASS", "a")], widths, checkedAt: at(0) }, null, NOW).headline, "Clean at all 8 widths");
  const v = viewportsVerdict({ findings: [f("FAIL", "a"), f("WARN", "b")], widths, checkedAt: at(0) },
                             { findings: [f("FAIL", "a"), f("FAIL", "c")], widths, checkedAt: at(2) }, NOW);
  assert.equal(v.headline, "1 thing breaks at some of the 8 widths");
  assert.equal(v.compare, "1 fewer than the last run, 2 hours ago");
  assert.equal(viewportsVerdict({ findings: [f("WARN", "a")], widths, checkedAt: at(0) }, null, NOW).headline, "No breaks · 1 thing worth a look across 8 widths");
  assert.equal(viewportsVerdict({ findings: [f("SKIP", "a")], widths, checkedAt: at(0) }, null, NOW).tone, "neutral");
});
