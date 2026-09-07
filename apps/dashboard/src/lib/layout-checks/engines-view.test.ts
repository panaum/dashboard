import { test } from "node:test";
import assert from "node:assert/strict";
import { comparableEngines, engineColumns } from "./engines-view";
import type { DeviceInput } from "./devices-view";

const desk = (id: string, engine: string, findings: { severity: string; rule: string; message: string; selector?: string; scope?: string }[] = []): DeviceInput =>
  ({ profile_id: id, label: id, engine, platform: "desktop", status: "ok", findings, viewport: { width: 1440, height: 900 }, is_mobile: false });
const phone = (id: string, engine: string): DeviceInput =>
  ({ profile_id: id, label: id, engine, platform: "ios", status: "ok", findings: [], viewport: { width: 393, height: 852 }, is_mobile: true });

test("comparison exists only for desktop profiles with at least two engines at the same size", () => {
  const all = [phone("iphone", "webkit"), desk("chrome", "chromium"), desk("firefox", "firefox"), desk("safari", "webkit")];
  assert.deepEqual(comparableEngines(all, "chrome").map((d) => d.engine), ["chromium", "firefox", "webkit"]);
  assert.deepEqual(comparableEngines(all, "safari").map((d) => d.engine), ["chromium", "firefox", "webkit"], "same trio whichever desktop is selected");
  assert.deepEqual(comparableEngines(all, "iphone"), [], "no Firefox iPhone to compare against");
  assert.deepEqual(comparableEngines([phone("iphone", "webkit"), desk("chrome", "chromium")], "chrome"), [], "one engine is not a comparison");
});

test("a finding present in one engine only is marked; shared ones are not", () => {
  const overflow = { severity: "error", rule: "overflow", message: "The page scrolls sideways by 14px (1454px wide in a 1440px viewport)", selector: "div.hero" };
  const tap = { severity: "warn", rule: "tap-small", message: "a is 20×20px — under the 24px WCAG AA minimum", selector: "a.x" };
  const cols = engineColumns([desk("chrome", "chromium", [overflow, tap]), desk("firefox", "firefox", [tap]), desk("safari", "webkit", [tap, overflow])]);
  assert.deepEqual(cols.map((c) => c.engineLabel), ["Chromium", "Gecko", "WebKit"]);
  assert.deepEqual(cols.map((c) => [c.errors, c.warnings]), [[1, 1], [0, 1], [1, 1]]);
  const gecko = cols[1];
  assert.equal(gecko.items[0].onlyHere, false, "tap-small a.x is in all three");
  const chromeOverflow = cols[0].items.find((i) => i.rule === "overflow")!;
  assert.equal(chromeOverflow.onlyHere, false, "overflow div.hero is in Chromium and WebKit");
  const only = engineColumns([desk("chrome", "chromium", [overflow]), desk("firefox", "firefox", [])]);
  assert.equal(only[0].items[0].onlyHere, true, "Chromium alone sees the overflow");
});
