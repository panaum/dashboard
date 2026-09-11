import { test } from "node:test";
import assert from "node:assert/strict";
import { CHECKS, cellsFor, cellWords, checkFor, coverage } from "@/lib/layout-checks/matrix";
import type { DeviceView } from "@/lib/layout-checks/devices-view";

const ok = (engine: string, findings: { severity: string; rule: string }[]) => ({ engine, status: "ok", findings });

test("findings roll up into their column, worst severity wins the tone", () => {
  const cells = cellsFor(ok("chromium", [
    { severity: "warn", rule: "tap-small" }, { severity: "warn", rule: "tap-close" }, { severity: "error", rule: "cls" },
    { severity: "info", rule: "image-size" },
  ]));
  const by = Object.fromEntries(cells.map((c) => [c.check, c]));
  assert.equal(by.tap.tone, "warning"); assert.equal(by.tap.count, 2);
  assert.equal(by.shift.tone, "error"); assert.equal(by.shift.count, 1);
  assert.equal(by.images.tone, "clean"); assert.equal(by.images.count, 0);   // a note does not tint
  assert.equal(by.fonts.tone, "clean");
});

test("layout shift cannot be measured off Chromium, and says so rather than looking clean", () => {
  const webkit = cellsFor(ok("webkit", [])).find((c) => c.check === "shift");
  const chromium = cellsFor(ok("chromium", [])).find((c) => c.check === "shift");
  assert.equal(webkit?.tone, "na");
  assert.equal(chromium?.tone, "clean");
});

test("a device that was blocked or failed has nothing to say in any column", () => {
  const cells = cellsFor({ engine: "chromium", status: "blocked", findings: [{ severity: "error", rule: "cls" }] });
  assert.ok(cells.every((c) => c.tone === "na"));
});

test("every rule the engine emits lands in exactly one column", () => {
  const rules = ["overflow", "element-wider", "tap-small", "tap-close", "clipped-text", "text-small", "fixed-chrome", "viewport-meta", "offscreen", "image-size", "cls", "webfont"];
  for (const r of rules) {
    assert.equal(CHECKS.filter((c) => c.rules.includes(r)).length, 1, r);
  }
});

test("a rule knows its check", () => {
  assert.equal(checkFor("tap-close")?.label, "Tap targets");
  assert.equal(checkFor("cls")?.id, "shift");
  assert.equal(checkFor("no-such-rule"), null);
});

test("coverage counts devices, not findings", () => {
  const v = (severity: DeviceView["severity"]) => ({ severity } as DeviceView);
  assert.deepEqual(coverage([v("error"), v("error"), v("warning"), v("clean"), v("inconclusive")]),
                   { failing: 2, warnings: 1, clean: 1, inconclusive: 1 });
});

test("cell words are for people", () => {
  const tap = CHECKS[1];
  assert.equal(cellWords({ check: "tap", tone: "warning", count: 3, errors: 1, warnings: 2 }, tap), "Tap targets: 1 error, 2 warnings");
  assert.equal(cellWords({ check: "tap", tone: "na", count: 0, errors: 0, warnings: 0 }, tap), "Tap targets: not measured on this device");
});
