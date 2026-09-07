import { test } from "node:test";
import assert from "node:assert/strict";
import { defaultSelection, groupDevices, groupOf, shapeOf, sortDevices, toView, type DeviceInput } from "./devices-view";

const dev = (id: string, over: Partial<DeviceInput> = {}, findings: { severity: string; rule: string; message: string }[] = []): DeviceInput => ({
  profile_id: id, label: id, engine: "webkit", platform: "ios", status: "ok", findings,
  viewport: { width: 393, height: 852 }, is_mobile: true, ...over,
});
const err = { severity: "error", rule: "overflow", message: "x" };
const warn = { severity: "warn", rule: "tap-small", message: "x" };

test("shape and group come from the profile, not the name", () => {
  assert.equal(shapeOf(dev("a")), "phone");
  assert.equal(shapeOf(dev("a", { viewport: { width: 1024, height: 1366 } })), "tablet");
  assert.equal(shapeOf(dev("a", { is_mobile: false, viewport: { width: 1440, height: 900 } })), "desktop");
  assert.equal(groupOf(dev("a")), "Apple");
  assert.equal(groupOf(dev("a", { platform: "android", engine: "chromium" })), "Android");
  assert.equal(groupOf(dev("a", { platform: "android", viewport: { width: 840, height: 1345 } })), "Tablet");
  assert.equal(groupOf(dev("a", { platform: "ipados", viewport: { width: 1024, height: 1366 } })), "Tablet");
  assert.equal(groupOf(dev("a", { platform: "desktop", is_mobile: false, viewport: { width: 1440, height: 900 } })), "Desktop");
});

test("engines are labelled, never selectable: firefox reads as Gecko", () => {
  assert.equal(toView(dev("a", { engine: "firefox" }), 0).engineLabel, "Gecko");
  assert.equal(toView(dev("a", { engine: "chromium" }), 0).engineLabel, "Chromium");
  assert.equal(toView(dev("a"), 0).viewportLabel, "393 × 852");
});

test("sort: inconclusive, then errors, then warnings, then clean; ties keep matrix order", () => {
  const views = [
    toView(dev("clean"), 0),
    toView(dev("warned", {}, [warn]), 1),
    toView(dev("broken", {}, [err]), 2),
    toView(dev("walled", { status: "blocked" }), 3),
    toView(dev("clean2"), 4),
    toView(dev("broken2", {}, [err, err]), 5),
  ];
  assert.deepEqual(sortDevices(views).map((v) => v.profileId), ["walled", "broken2", "broken", "warned", "clean", "clean2"]);
});

test("groups appear in a fixed order, each worst first, empty groups omitted", () => {
  const views = [
    toView(dev("desk", { platform: "desktop", is_mobile: false, viewport: { width: 1440, height: 900 }, engine: "chromium" }), 0),
    toView(dev("iphone-clean"), 1),
    toView(dev("iphone-broken", {}, [err]), 2),
    toView(dev("pixel", { platform: "android", engine: "chromium" }, [warn]), 3),
  ];
  const g = groupDevices(views);
  assert.deepEqual(g.map((x) => x.group), ["Apple", "Android", "Desktop"]);
  assert.deepEqual(g[0].devices.map((v) => v.profileId), ["iphone-broken", "iphone-clean"]);
});

test("default selection is the worst device, or the smallest phone when all is clean", () => {
  const broken = [toView(dev("big", { viewport: { width: 440, height: 956 } }), 0), toView(dev("bad", {}, [err]), 1)];
  assert.equal(defaultSelection(broken), "bad");
  const clean = [
    toView(dev("big", { viewport: { width: 440, height: 956 } }), 0),
    toView(dev("desk", { platform: "desktop", is_mobile: false, viewport: { width: 1440, height: 900 } }), 1),
    toView(dev("se", { viewport: { width: 375, height: 667 } }), 2),
  ];
  assert.equal(defaultSelection(clean), "se");
  assert.equal(defaultSelection([]), null);
});
