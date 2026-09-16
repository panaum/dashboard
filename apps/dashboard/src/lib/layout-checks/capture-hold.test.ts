import { test } from "node:test";
import assert from "node:assert/strict";
import { captureHold, holdNote, softCaptureNote, undrawnLabel } from "./capture-hold";

// The numbers are a real run: wbiwarm.com/wbi-mechanical-systems/ on the three
// 3x iPhone profiles, 2026-09-16. Every one of them stops at the same place,
// because the limit is the image's, not the page's or the device's.
const RUN = [
  { device: "iphone-16", page: 19588, shown: 10919 },
  { device: "iphone-13-pro-max", page: 19112, shown: 10919 },
  { device: "iphone-17-pro-max", page: 18960, shown: 10919 },
];

test("a page taller than the capture is a hold, with both heights kept", () => {
  for (const r of RUN) {
    const hold = captureHold(r.page, r.shown);
    assert.deepEqual(hold, { shown: r.shown, page: r.page }, r.device);
  }
});

test("a capture that reaches the foot of the page is not a hold", () => {
  assert.equal(captureHold(2556, 2556), null);
  assert.equal(captureHold(9000, 9000), null);
  // Whole device pixels against CSS pixels: a page 3,417.6 CSS px tall is
  // captured as 10,253 device px, which is 3,417.67 back. Not a hold.
  assert.equal(captureHold(3418, 3417.67), null);
  assert.equal(captureHold(9000, 8997), null);
  // A capture longer than the page (a footer that shrank after measuring).
  assert.equal(captureHold(9000, 9200), null);
});

test("nothing is claimed from a height that is not there", () => {
  for (const [page, shown] of [[null, 10919], [19588, null], [undefined, undefined],
                               [0, 10919], [19588, 0], [NaN, 10919], [19588, Infinity]] as const) {
    assert.equal(captureHold(page, shown), null, `${String(page)} / ${String(shown)}`);
  }
});

test("the note says where it stops, how long the page is, and what to do", () => {
  // An old run of a page that today's capture would take whole: one button.
  assert.equal(holdNote({ shown: 10919, page: 19588 }),
    "Capture stops 10,919px into a 19,588px page. Run the check again and the new capture takes in all of it. "
    + "Findings below it were measured, not drawn.");
  // Long enough to be worth grouping the digits.
  assert.match(holdNote({ shown: 10919, page: 32767 }), /32,767px/);
  // A page no image can hold at any scale: re-running would stop short again,
  // so it is not offered.
  const huge = holdNote({ shown: 32767, page: 48000 });
  assert.match(huge, /No screenshot can be taller, at any scale/);
  assert.doesNotMatch(huge, /Run the check again/);
});

test("a finding with no picture says which of the two reasons it is", () => {
  assert.match(undrawnLabel({ shown: 10919, page: 19588 }), /below where the capture stops/);
  assert.match(undrawnLabel(null), /not stored/);
});

test("a page captured at 1x to fit says so, and nothing is said about the rest", () => {
  // The same run: 19,588px at 3x does not fit, so the capture drops to 1x.
  assert.equal(softCaptureNote("css", 19588),
    "Full page captured at 1x so all 19,588px of it fit — the first screen is at the device's own density.");
  // The height is a nicety, not a requirement.
  assert.match(softCaptureNote("css", null) ?? "", /^Full page captured at 1x — /);
  for (const scale of ["device", null, undefined, ""]) {
    assert.equal(softCaptureNote(scale, 19588), null, String(scale));
  }
});
