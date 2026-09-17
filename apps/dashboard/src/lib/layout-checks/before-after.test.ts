import { test } from "node:test";
import assert from "node:assert/strict";
import { beforeAfterLine, deviceChanges, whenWords } from "./before-after";

const f = (rule: string, selector: string | null = null, scope?: string) => ({ rule, selector, scope });
const ok = (...findings: ReturnType<typeof f>[]) => ({ status: "ok", findings });

test("one device, two runs: fixed, new and still there", () => {
  const prev = ok(f("tap-small", "a.cta"), f("text-small", "span.note"));
  const cur = ok(f("text-small", "span.note"), f("cls", null, "page"));
  assert.deepEqual(deviceChanges(cur, prev), { fixed: ["tap-small|a.cta"], added: ["cls|"], kept: ["text-small|span.note"] });
});

test("no capture of the device last time is no comparison, not a clean one", () => {
  assert.equal(deviceChanges(ok(f("cls", null, "page")), null), null);
  assert.equal(deviceChanges(ok(), { status: "blocked", findings: [] }), null);
  assert.equal(deviceChanges({ status: "failed", findings: [] }, ok()), null);
});

test("the line says what moved, and says out loud when nothing did", () => {
  assert.equal(beforeAfterLine({ fixed: ["a", "b"], added: ["c"], kept: ["d", "e", "f"] }),
    "On this device since the last run: 2 fixed · 1 new · 3 still there");
  assert.equal(beforeAfterLine({ fixed: ["a"], added: [], kept: [] }), "On this device since the last run: 1 fixed");
  assert.equal(beforeAfterLine({ fixed: [], added: [], kept: ["k", "l"] }),
    "Nothing changed on this device: 2 findings then, the same ones now.");
  assert.equal(beforeAfterLine({ fixed: [], added: [], kept: ["k"] }),
    "Nothing changed on this device: 1 finding then, the same one now.");
  assert.equal(beforeAfterLine({ fixed: [], added: [], kept: [] }), "Nothing changed on this device: clean then, clean now.");
  assert.equal(beforeAfterLine(null), "The last run has no capture of this device to compare with.");
});

test("a caption date is short and readable, and a bad date is nothing", () => {
  assert.match(whenWords("2026-09-16T05:22:00Z"), /^16 Sept?, \d\d:\d\d$/);
  assert.equal(whenWords("not a date"), "");
});
