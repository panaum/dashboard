import { test } from "node:test";
import assert from "node:assert/strict";
import { readDeviceView, readWidthView, withQuery } from "@/lib/layout-checks/deep-link";

const P = (s: string) => new URLSearchParams(s);
const DEVICES = ["iphone-16", "galaxy-s25"];

test("a known device and a finding are read back", () => {
  assert.deepEqual(readDeviceView(P("tab=devices&device=galaxy-s25&finding=3"), DEVICES), { device: "galaxy-s25", finding: "3" });
});

test("a device the run does not have is ignored, not selected", () => {
  assert.deepEqual(readDeviceView(P("device=pixel-9&finding=2"), DEVICES), { device: null, finding: "2" });
});

test("a comparison finding id keeps its engine prefix", () => {
  assert.equal(readDeviceView(P("finding=gecko:4"), DEVICES).finding, "gecko:4");
});

test("junk in finding= is dropped", () => {
  assert.equal(readDeviceView(P("finding=<script>"), DEVICES).finding, null);
  assert.equal(readDeviceView(P("finding=" + "a".repeat(40)), DEVICES).finding, null);
});

test("a width must be one the run captured", () => {
  assert.deepEqual(readWidthView(P("width=425&finding=1"), [350, 425]), { width: 425, finding: "1" });
  assert.deepEqual(readWidthView(P("width=999"), [350, 425]), { width: null, finding: null });
  assert.equal(readWidthView(P("width=abc"), [350]).width, null);
});

test("withQuery sets, removes and preserves", () => {
  assert.equal(withQuery("?tab=devices", { device: "iphone-16", finding: null }), "?tab=devices&device=iphone-16");
  assert.equal(withQuery("?tab=devices&device=iphone-16&finding=3", { finding: null }), "?tab=devices&device=iphone-16");
  assert.equal(withQuery("?device=x", { device: "" }), "");
  assert.equal(withQuery("", { width: 350 }), "?width=350");
});
