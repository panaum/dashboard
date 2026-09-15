import test from "node:test";
import assert from "node:assert/strict";
import { appleFonts, frameNote, hostName } from "./provenance";

test("the host is named the way a person would say it", () => {
  assert.equal(hostName("darwin"), "macOS");
  assert.equal(hostName("linux"), "Linux");
  assert.equal(hostName(undefined), "");
  assert.equal(hostName("freebsd"), "freebsd", "an unknown host is reported, not hidden");
});

test("the measurement wins over the finding", () => {
  assert.equal(appleFonts({ fonts: { appleSystemFontRequested: true, appleSystemFontAuthentic: true } }), "authentic");
  assert.equal(appleFonts({ fonts: { appleSystemFontRequested: true, appleSystemFontAuthentic: false } }), "substituted");
  // Requested but unmeasured is not the same as fine.
  assert.equal(appleFonts({ fonts: { appleSystemFontRequested: true, appleSystemFontAuthentic: null } }), "unknown");
  assert.equal(appleFonts({ fonts: { appleSystemFontRequested: false } }), "not-asked");
});

test("a run from before the measurement still reports what it knew", () => {
  assert.equal(
    appleFonts({ findings: [{ message: "Page requests Apple's system font (-apple-system / SF Pro); it is substituted" }] }),
    "substituted");
  assert.equal(appleFonts({}), "unknown", "no fonts block and no finding means we do not know");
});

test("a substituted capture says so, whatever the frame looks like", () => {
  const n = frameNote(
    { fonts: { appleSystemFontRequested: true, appleSystemFontAuthentic: false } },
    { host: { platform: "linux" } });
  assert.equal(n.label, "Linux capture — Apple fonts substituted");
  assert.equal(n.tone, "warn");
});

test("an authentic capture on a known host is the only quiet case", () => {
  const n = frameNote(
    { fonts: { appleSystemFontRequested: true, appleSystemFontAuthentic: true } },
    { host: { platform: "darwin" } });
  assert.equal(n.label, "macOS capture — real Apple fonts");
  assert.equal(n.tone, "ok");
});

test("a page that never asked for Apple's font is not told about it", () => {
  const n = frameNote({ fonts: { appleSystemFontRequested: false } }, { host: { platform: "linux" } });
  assert.equal(n.label, "Linux capture");
  assert.equal(n.tone, "ok");
});

test("an unrecorded host is never presented as fine", () => {
  for (const device of [
    { fonts: { appleSystemFontRequested: false } },
    { fonts: { appleSystemFontRequested: true, appleSystemFontAuthentic: true } },
    {},
  ]) {
    assert.equal(frameNote(device, {}).tone, "warn", JSON.stringify(device));
  }
});

test("the label is never empty, so the frame always says something", () => {
  for (const device of [{}, { fonts: {} }, { findings: [] }]) {
    for (const run of [{}, { host: { platform: "linux" } }, { host: {} }]) {
      assert.ok(frameNote(device, run).label.length > 0);
      assert.ok(frameNote(device, run).detail.length > 0);
    }
  }
});
