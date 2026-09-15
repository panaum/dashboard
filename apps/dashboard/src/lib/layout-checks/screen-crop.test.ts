import { test } from "node:test";
import assert from "node:assert/strict";
import { screenCrop } from "./screen-crop";

// The S25 model's screen: 2.0901 × 4.5238 model units. The profile's viewport,
// 412 × 892, is within 0.03% of it.
const ASPECT = 2.0901 / 4.5238;
const MAX = 2048;

test("a fold capture — one screen tall — is used whole, and fills the texture", () => {
  const c = screenCrop({ width: 1236, height: 2676 }, ASPECT, MAX)!;
  assert.ok(Math.abs(c.sourceHeight - 2676) < 2, `took ${c.sourceHeight} of 2676`);
  assert.equal(c.drawnHeight, c.height);
});

test("a full-page capture shows its first screen only, not the page squeezed", () => {
  const c = screenCrop({ width: 900, height: 6000 }, ASPECT, MAX)!;
  assert.equal(c.sourceWidth, 900);
  assert.ok(Math.abs(c.sourceHeight - 900 / ASPECT) < 1e-9);
  assert.equal(c.width, 900);
  assert.equal(c.drawnHeight, c.height);
});

test("the texture keeps the screen's proportions to within a pixel", () => {
  for (const natural of [{ width: 412, height: 892 }, { width: 900, height: 6000 }, { width: 1236, height: 20000 }, { width: 3000, height: 3000 }]) {
    for (const max of [MAX, 1024, 16384]) {
      const c = screenCrop(natural, ASPECT, max)!;
      assert.ok(Math.abs(c.height * ASPECT - c.width) <= ASPECT + 1e-9, `${JSON.stringify(natural)} @${max}: ${c.width}×${c.height}`);
    }
  }
});

test("no side exceeds the GPU limit, and nothing is upscaled", () => {
  const big = screenCrop({ width: 1236, height: 20000 }, ASPECT, MAX)!;
  assert.ok(big.width <= MAX && big.height <= MAX);
  const old = screenCrop({ width: 1236, height: 20000 }, ASPECT, 1024)!;
  assert.ok(old.width <= 1024 && old.height <= 1024);
  const small = screenCrop({ width: 412, height: 892 }, ASPECT, MAX)!;
  assert.equal(small.width, 412, "a small capture is not blown up");
});

test("a page shorter than one screen is drawn at the top with white below", () => {
  const c = screenCrop({ width: 900, height: 1000 }, ASPECT, MAX)!;
  assert.equal(c.sourceHeight, 1000);
  assert.ok(c.drawnHeight < c.height);
  assert.equal(c.drawnHeight, Math.round((1000 * c.width) / 900));
});

test("nothing usable gives no crop, rather than a zero-sized or NaN texture", () => {
  assert.equal(screenCrop({ width: 0, height: 892 }, ASPECT, MAX), null);
  assert.equal(screenCrop({ width: 412, height: 0 }, ASPECT, MAX), null);
  assert.equal(screenCrop({ width: 412, height: 892 }, 0, MAX), null);
  assert.equal(screenCrop({ width: 412, height: 892 }, Number.NaN, MAX), null);
  assert.equal(screenCrop({ width: 412, height: 892 }, ASPECT, 0), null);
});
