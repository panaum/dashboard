import { test } from "node:test";
import assert from "node:assert/strict";
import { spark, trendValues } from "@/lib/layout-checks/sparkline";

test("newest-first runs become an oldest-first line, capped", () => {
  const runs = [7, 6, 5, 4, 3, 2, 1, 0, 9].map((e, i) => ({ checkedAt: `2026-09-${10 - i}`, errors: e }));
  assert.deepEqual(trendValues(runs, 8), [0, 1, 2, 3, 4, 5, 6, 7]);
});

test("the highest value sits at the top pad, the lowest at the bottom pad", () => {
  const s = spark([7, 6, 4], 300, 60, 6);
  assert.equal(s.dots[0].y, 6);
  assert.equal(s.dots[2].y, 54);
  assert.equal(s.dots[0].x, 0); assert.equal(s.dots[2].x, 300);
});

test("a flat run draws flat, mid-height, and one point sits in the middle", () => {
  assert.ok(spark([3, 3, 3], 300, 60).dots.every((d) => d.y === 30));
  assert.deepEqual(spark([2], 300, 60).dots, [{ x: 150, y: 30, value: 2 }]);
  assert.equal(spark([], 300, 60).points, "");
});
