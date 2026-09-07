import { test } from "node:test";
import assert from "node:assert/strict";
import {
  IDLE_PROGRESS, isBusy, mergePoll, parseDeviceLine, progressNote, progressPct,
} from "@/lib/layout-checks/run-progress";

test("parses the CLI's per-capture line", () => {
  assert.deepEqual(
    parseDeviceLine("  iPhone 16                    webkit   light  ok        4213ms"),
    { label: "iPhone 16", state: "captured" },
  );
  assert.deepEqual(
    parseDeviceLine("  Samsung Galaxy S25 Ultra     chromium light  failed    1102ms  — net::ERR_ABORTED"),
    { label: "Samsung Galaxy S25 Ultra", state: "failed" },
  );
  assert.deepEqual(
    parseDeviceLine("  Galaxy Z Flip (unfolded)     chromium dark   blocked   9000ms"),
    { label: "Galaxy Z Flip (unfolded)", state: "failed" },
    "a bot wall is not a capture",
  );
});

test("a label longer than the pad still parses", () => {
  assert.deepEqual(
    parseDeviceLine("  A device with a very long label indeed firefox light  ok       900ms"),
    { label: "A device with a very long label indeed", state: "captured" },
  );
});

test("other stderr lines are not devices", () => {
  for (const line of [
    "  14 device(s) × 1 scheme(s), 3 engine(s) in parallel",
    "  iPhone 16: retrying with 60s timeout — timeout",
    "  iPhone 16                    diff   0.00%  ok        chromium",
    "  gallery: runs/2026-09-07/report.html",
    "",
  ]) assert.equal(parseDeviceLine(line), null, line);
});

test("merging keeps every device a poll has seen", () => {
  let p = mergePoll(IDLE_PROGRESS, { phase: "running", done: 1, total: 14, message: "  iPhone 16                    webkit   light  ok        4213ms" });
  p = mergePoll(p, { done: 2, message: "  iPad Pro 13\"                 webkit   light  ok        5100ms" });
  p = mergePoll(p, { done: 3, message: "  Xiaomi 15                    chromium light  blocked   9000ms" });
  assert.deepEqual(p.devices, { "iPhone 16": "captured", 'iPad Pro 13"': "captured", "Xiaomi 15": "failed" });
  assert.equal(p.total, 14, "total survives a poll that does not repeat it");
  assert.equal(p.done, 3);
});

test("a poll whose line is not a device changes nothing but the counters", () => {
  const p = mergePoll(
    { phase: "running", done: 1, total: 14, message: "x", devices: { "iPhone 16": "captured" } },
    { done: 2, message: "  gallery: runs/x/report.html" },
  );
  assert.deepEqual(p.devices, { "iPhone 16": "captured" });
  assert.equal(p.done, 2);
});

test("the bar waits for a total rather than inventing one", () => {
  assert.equal(progressPct({ ...IDLE_PROGRESS, phase: "running", done: 3, total: null }), 0);
  assert.equal(progressPct({ ...IDLE_PROGRESS, done: 7, total: 14 }), 50);
  assert.equal(progressPct({ ...IDLE_PROGRESS, done: 14, total: 14 }), 100);
});

test("the note says what is true at each phase", () => {
  assert.match(progressNote({ ...IDLE_PROGRESS, phase: "running", done: 0, total: null }), /Starting the browsers/);
  assert.match(progressNote({ ...IDLE_PROGRESS, phase: "running", done: 9, total: 14 }), /9 of 14 done/);
  assert.match(progressNote({ ...IDLE_PROGRESS, phase: "running", done: 9, total: 14 }), /Findings appear once the run is saved/);
  assert.match(progressNote({ ...IDLE_PROGRESS, phase: "saving" }), /Saving/);
  assert.equal(progressNote({ ...IDLE_PROGRESS, phase: "failed", message: "Another preview is running right now." }), "Another preview is running right now.");
  assert.equal(progressNote(IDLE_PROGRESS), "");
});

test("busy covers the save, not just the capture", () => {
  assert.equal(isBusy({ ...IDLE_PROGRESS, phase: "running" }), true);
  assert.equal(isBusy({ ...IDLE_PROGRESS, phase: "saving" }), true);
  assert.equal(isBusy({ ...IDLE_PROGRESS, phase: "done" }), false);
  assert.equal(isBusy(IDLE_PROGRESS), false);
});
