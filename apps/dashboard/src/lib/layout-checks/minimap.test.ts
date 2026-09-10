import { test } from "node:test";
import assert from "node:assert/strict";
import { bandFor, dotFor, scrollForThumb, worthMapping } from "@/lib/layout-checks/minimap";

test("the band is the window's share of the page, at the scroll position", () => {
  // 10,000px page, 500px window, 600px track: window is 5% → 30px band
  assert.deepEqual(bandFor(0, 10000, 500, 600), { top: 0, height: 30 });
  assert.deepEqual(bandFor(5000, 10000, 500, 600), { top: 300, height: 30 });
});

test("the band never leaves the track, even when scrolled past the end", () => {
  const b = bandFor(99999, 10000, 500, 600);
  assert.ok(b.top + b.height <= 600);
});

test("a very long page still gets a thumb you can grab", () => {
  assert.ok(bandFor(0, 200000, 500, 600).height >= 24);
});

test("dragging the thumb to a point on the track scrolls the page to match", () => {
  // 10,000px page, 500px window, 600px track, 30px thumb: 570px of travel maps to 9,500px of scroll
  assert.equal(scrollForThumb(0, 30, 600, 10000, 500), 0);
  assert.equal(scrollForThumb(570, 30, 600, 10000, 500), 9500);
  assert.equal(scrollForThumb(285, 30, 600, 10000, 500), 4750);
  assert.equal(scrollForThumb(9999, 30, 600, 10000, 500), 9500);   // past the end is the end
  assert.equal(scrollForThumb(-50, 30, 600, 10000, 500), 0);
});

test("the thumb and the drag agree: a band's own top drags to its own scroll position", () => {
  const b = bandFor(4200, 10000, 500, 600);
  assert.ok(Math.abs(scrollForThumb(b.top, b.height, 600, 10000, 500) - 4200) <= 40);
});

test("a pin's dot is at the centre of its box, in track proportions", () => {
  assert.deepEqual(dotFor({ x: 100, y: 1000, width: 200, height: 100 }, 400, 20000, 56, 600), { left: 28, top: 32 });
});

test("a page that fits the window has no use for a map", () => {
  assert.equal(worthMapping(500, 500), false);
  assert.equal(worthMapping(null, 500), false);
  assert.equal(worthMapping(2000, 500), true);
});

import { clusterDots } from "@/lib/layout-checks/minimap";

test("pins on the same element become one dot that names them all, in the worst colour", () => {
  const box = { x: 20, y: 500, width: 200, height: 40 };
  const dots = clusterDots([
    { id: "2", n: 2, severity: "warn", box },
    { id: "3", n: 3, severity: "error", box },
    { id: "4", n: 4, severity: "info", box },
    { id: "9", n: 9, severity: "warn", box: { x: 20, y: 9000, width: 200, height: 40 } },
  ], 400, 20000, 56, 600);
  assert.equal(dots.length, 2);
  assert.deepEqual(dots[0].ids, ["2", "3", "4"]);
  assert.equal(dots[0].severity, "error");
  assert.deepEqual(dots[1].ids, ["9"]);
});
