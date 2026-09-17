import { test } from "node:test";
import assert from "node:assert/strict";
import { changesLine, diffDevices, diffViewports, sinceOf } from "./run-diff";

const f = (rule: string, selector: string | null = null, scope?: string) => ({ rule, selector, scope });
const ok = (...findings: ReturnType<typeof f>[]) => ({ status: "ok", findings });

test("a fault reported last run and gone now is fixed; one that arrived is new; one in both is still there", () => {
  const prev = [ok(f("tap-small", "a.cta"), f("text-small", "span.note"), f("cls", null, "page"))];
  const cur = [ok(f("text-small", "span.note"), f("cls", null, "page"), f("tap-close", "a.cta"))];
  const d = diffDevices(cur, prev);
  assert.deepEqual(d, { fixed: ["tap-small|a.cta"], added: ["tap-close|a.cta"], kept: ["text-small|span.note", "cls|"] });
});

test("a fault that moved from one device to another is still there, not fixed and new", () => {
  const prev = [ok(f("tap-small", "a.cta")), ok()];
  const cur = [ok(), ok(f("tap-small", "a.cta"))];
  const d = diffDevices(cur, prev);
  assert.deepEqual(d, { fixed: [], added: [], kept: ["tap-small|a.cta"] });
});

test("a device that did not capture says nothing about its faults either way", () => {
  const prev = [ok(f("tap-small", "a.cta"))];
  const cur = [{ status: "blocked", findings: [] }];
  // Nothing audited now, so the fault reads as fixed — the verdict says the
  // run was inconclusive; this only says what the audited devices reported.
  assert.deepEqual(diffDevices(cur, prev)?.fixed, ["tap-small|a.cta"]);
});

test("the same fault reported twice on one device is one fault", () => {
  const cur = [ok(f("tap-small", "a.cta"), f("tap-small", "a.cta"))];
  assert.deepEqual(diffDevices(cur, [ok()])?.added, ["tap-small|a.cta"]);
});

test("without a previous run there is nothing to say", () => {
  assert.equal(diffDevices([ok(f("cls", null, "page"))], null), null);
  assert.equal(diffViewports([{ id: "overflow", status: "FAIL" }], undefined), null);
});

test("on the Viewports tab a change is a rule crossing into or out of FAIL/WARN", () => {
  const prev = [{ id: "overflow", status: "FAIL" }, { id: "clipped", status: "WARN" }, { id: "edge", status: "PASS" }];
  const cur = [{ id: "overflow", status: "PASS" }, { id: "clipped", status: "WARN" }, { id: "edge", status: "WARN" }];
  assert.deepEqual(diffViewports(cur, prev), { fixed: ["overflow"], added: ["edge"], kept: ["clipped"] });
});

test("a rule going from FAIL to WARN is still there — it has not gone", () => {
  const d = diffViewports([{ id: "overflow", status: "WARN" }], [{ id: "overflow", status: "FAIL" }]);
  assert.deepEqual(d, { fixed: [], added: [], kept: ["overflow"] });
});

test("a row knows whether it is new or was there last time", () => {
  const d = { fixed: ["a|"], added: ["b|x"], kept: ["c|y"] };
  assert.equal(sinceOf(d, "b|x"), "new");
  assert.equal(sinceOf(d, "c|y"), "still");
  assert.equal(sinceOf(d, "a|"), null, "a fixed fault has no row to mark");
  assert.equal(sinceOf(null, "b|x"), null);
});

test("the line names what moved, and stays quiet when nothing did", () => {
  assert.equal(changesLine({ fixed: ["a", "b", "c"], added: ["d"], kept: Array(12).fill("k") }),
    "Since the last run: 3 fixed · 1 new · 12 still there");
  assert.equal(changesLine({ fixed: ["a"], added: [], kept: [] }), "Since the last run: 1 fixed");
  assert.equal(changesLine({ fixed: [], added: ["a", "b"], kept: ["k"] }), "Since the last run: 2 new · 1 still there");
  // Same faults both runs: the verdict already says "Same as the last run".
  assert.equal(changesLine({ fixed: [], added: [], kept: ["k", "l"] }), null);
  assert.equal(changesLine(null), null);
});
