import { test } from "node:test";
import assert from "node:assert/strict";
import {
  defaultSelection, groupDevices, groupOf, groupOfProfile, groupSummary, shapeOf, sortDevices,
  toView, type DeviceInput, type DeviceView, type Severity,
} from "./devices-view";

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

// ── the collapsed picker ────────────────────────────────────────────────────

test("a closed group says whether there is anything in it", () => {
  const v = (severity: Severity, profileId = severity) =>
    ({ profileId, severity } as unknown as DeviceView);
  assert.deepEqual(groupSummary([v("clean", "a"), v("clean", "b")]),
    { label: "all clean", tone: "success" });
  assert.deepEqual(groupSummary([v("clean", "a"), v("warning", "b")]),
    { label: "1 to review", tone: "warning" });
  assert.deepEqual(groupSummary([v("warning", "a"), v("warning", "b")]),
    { label: "2 to review", tone: "warning" });
  assert.deepEqual(groupSummary([v("warning", "a"), v("error", "b")]),
    { label: "1 with error", tone: "error" }, "the worst wins, and it is singular at one");
  assert.deepEqual(groupSummary([v("error", "a"), v("error", "b")]),
    { label: "2 with errors", tone: "error" });
  assert.deepEqual(groupSummary([v("clean", "a"), v("inconclusive", "b")]),
    { label: "1 not captured", tone: "neutral" }, "a device that never rendered is not clean");
  assert.deepEqual(groupSummary([]), { label: "all clean", tone: "success" });
});

test("the picker knows which group to open for the selected device", () => {
  const views = [
    { profileId: "iphone-16", group: "Apple" },
    { profileId: "s25", group: "Android" },
  ] as unknown as DeviceView[];
  assert.equal(groupOfProfile(views, "s25"), "Android");
  assert.equal(groupOfProfile(views, "iphone-16"), "Apple");
  assert.equal(groupOfProfile(views, "nope"), null);
  assert.equal(groupOfProfile(views, null), null);
});
