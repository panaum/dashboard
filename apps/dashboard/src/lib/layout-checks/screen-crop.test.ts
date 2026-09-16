import { test } from "node:test";
import assert from "node:assert/strict";
import { screenCrop, scrollRange, toSourcePixels } from "./screen-crop";

// The S25 model's screen: 2.0901 × 4.5238 model units. The profile's viewport,
// 412 × 892, is within 0.03% of it.
const ASPECT = 2.0901 / 4.5238;
const MAX = 2048;
// The Galaxy S25 profile's viewport, in CSS px.
const S25 = { width: 412, height: 892 };

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

// ── Scrolling the capture on the screen ──

test("a fold capture — one screen — cannot be scrolled, so the wheel belongs to the page", () => {
  assert.equal(scrollRange({ width: 1236, height: 2676 }, S25), 0);
  assert.equal(scrollRange({ width: 900, height: 900 }, S25), 0, "shorter than one screen is not scrollable either");
});

test("a full-page capture scrolls by the page's own height, less one screen", () => {
  // 900px wide at a 412px viewport is 2.184× scale; 6000px of capture is 2746.7 CSS px of page.
  const range = scrollRange({ width: 900, height: 6000 }, S25);
  assert.ok(Math.abs(range - ((6000 * 412) / 900 - 892)) < 1e-9, String(range));
});

test("scrolling moves the window down the capture, and stops at its foot", () => {
  const natural = { width: 900, height: 6000 };
  const top = screenCrop(natural, ASPECT, MAX, 0)!;
  assert.equal(top.sourceTop, 0);
  const mid = screenCrop(natural, ASPECT, MAX, 1000)!;
  assert.equal(mid.sourceTop, 1000);
  assert.equal(mid.sourceHeight, top.sourceHeight, "the same amount of page, further down");
  assert.equal(mid.drawnHeight, mid.height, "and it still fills the screen");
  const past = screenCrop(natural, ASPECT, MAX, 99_999)!;
  assert.ok(Math.abs(past.sourceTop - (6000 - past.sourceHeight)) < 1e-9, "clamped to the foot of the page");
  assert.equal(past.drawnHeight, past.height, "the last screen is a full screen, not a sliver");
});

test("a nonsense scroll position is treated as the top, not as NaN", () => {
  for (const bad of [Number.NaN, -500, Number.POSITIVE_INFINITY]) {
    const c = screenCrop({ width: 900, height: 6000 }, ASPECT, MAX, bad)!;
    assert.ok(c.sourceTop >= 0 && c.sourceTop <= 6000 - c.sourceHeight, `${bad} → ${c.sourceTop}`);
  }
  assert.equal(toSourcePixels(Number.NaN, { width: 900 }, { width: 412 }), 0);
});

test("CSS pixels of page convert to capture pixels by the capture's scale", () => {
  assert.ok(Math.abs(toSourcePixels(100, { width: 900 }, { width: 412 }) - (100 * 900) / 412) < 1e-9);
  assert.equal(toSourcePixels(100, { width: 0 }, { width: 412 }), 0);
});
