import { test } from "node:test";
import assert from "node:assert/strict";
import { bandFor, dotFor, scrollFor, worthMapping } from "@/lib/layout-checks/minimap";

test("the band is the window's share of the page, at the scroll position", () => {
  // 10,000px page, 500px window, 600px track: window is 5% → 30px band
  assert.deepEqual(bandFor(0, 10000, 500, 600), { top: 0, height: 30 });
  assert.deepEqual(bandFor(5000, 10000, 500, 600), { top: 300, height: 30 });
});

test("the band never leaves the track, even when scrolled past the end", () => {
  const b = bandFor(99999, 10000, 500, 600);
  assert.ok(b.top + b.height <= 600);
});

test("a very long page still gets a band you can see", () => {
  assert.ok(bandFor(0, 200000, 500, 600).height >= 6);
});

test("clicking a point centres it in the window", () => {
  // midpoint of a 10,000px page in a 500px window → scroll to 5000 − 250
  assert.equal(scrollFor(0.5, 10000, 500), 4750);
  assert.equal(scrollFor(0, 10000, 500), 0);
  assert.equal(scrollFor(1, 10000, 500), 9500);       // clamped to the last screen
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
