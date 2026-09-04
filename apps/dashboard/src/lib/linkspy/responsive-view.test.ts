import { test } from "node:test";
import assert from "node:assert/strict";

import {
  type ResponsiveFinding,
  FINDING_TONE,
  orderFindings,
  progressPercent,
  shotWidths,
  summarize,
  widthLabel,
} from "./responsive-view";

const f = (status: ResponsiveFinding["status"], id = status): ResponsiveFinding => ({
  id, status, title: id,
});

test("worst findings sort first", () => {
  const out = orderFindings([f("PASS"), f("INFO"), f("FAIL"), f("WARN"), f("SKIP")]);
  assert.deepEqual(out.map((x) => x.status), ["FAIL", "WARN", "SKIP", "INFO", "PASS"]);
});

test("ordering does not mutate the input", () => {
  const input = [f("PASS"), f("FAIL")];
  orderFindings(input);
  assert.deepEqual(input.map((x) => x.status), ["PASS", "FAIL"]);
});

test("every status has a tone", () => {
  for (const s of ["FAIL", "WARN", "PASS", "INFO", "SKIP"] as const) {
    assert.ok(FINDING_TONE[s], `${s} needs a tone`);
  }
});

test("a failure leads the summary even when warnings outnumber it", () => {
  const s = summarize([f("FAIL"), f("WARN"), f("WARN"), f("PASS")], 8);
  assert.equal(s.tone, "error");
  assert.equal(s.fail, 1);
  assert.match(s.headline, /break/);
});

test("warnings lead when nothing failed", () => {
  const s = summarize([f("WARN"), f("PASS")], 8);
  assert.equal(s.tone, "warning");
  assert.match(s.headline, /worth a look/);
});

test("a clean sweep says so, with the width count", () => {
  const s = summarize([f("PASS"), f("PASS"), f("INFO")], 8);
  assert.equal(s.tone, "success");
  assert.match(s.headline, /8 screen widths/);
});

test("singular and plural read correctly", () => {
  assert.match(summarize([f("FAIL")], 8).headline, /1 thing breaks/);
  assert.match(summarize([f("FAIL"), f("FAIL")], 8).headline, /2 things break/);
});

test("no findings is not reported as clean", () => {
  const s = summarize([], 8);
  assert.equal(s.tone, "neutral");
  assert.match(s.headline, /No sweep/);
});

test("shot widths come back ascending, junk dropped", () => {
  assert.deepEqual(shotWidths({ shot_widths: [1440, 350, 768] }), [350, 768, 1440]);
  assert.deepEqual(shotWidths({ shot_widths: [0, -5, NaN, 375] as number[] }), [375]);
  assert.deepEqual(shotWidths(null), []);
});

test("progress is clamped to 0-100", () => {
  assert.equal(progressPercent({ percent: 42 }), 42);
  assert.equal(progressPercent({ percent: 140 }), 100);
  assert.equal(progressPercent({ percent: -3 }), 0);
  assert.equal(progressPercent(undefined), 0);
  assert.equal(progressPercent({} as { percent?: number }), 0);
});

test("widths are labelled in words a layman reads", () => {
  assert.match(widthLabel(350), /phone/);
  assert.match(widthLabel(470), /phone/);
  assert.match(widthLabel(768), /tablet/);
  assert.match(widthLabel(1440), /desktop/);
});
