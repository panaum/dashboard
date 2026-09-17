import { test } from "node:test";
import assert from "node:assert/strict";
import { IMAGE_HEIGHT, IMAGE_WIDTH, imagePlan } from "./finding-image";

// A real finding: the 77 × 14 tap target on wbiwarm.com at 412 CSS px, in a
// stored fold that is 900px wide (2.18 image px per CSS px).
const BOX = { x: 20, y: 96, width: 77, height: 14 };
const PAGE = { width: 412, height: 892 };
const CAPTURE = { width: 900, height: 1948 };

test("the picture is a fixed size, and the source is cut from the capture at its own density", () => {
  const p = imagePlan(BOX, PAGE, CAPTURE);
  assert.ok(p);
  assert.equal(p.width, IMAGE_WIDTH);
  assert.equal(p.height, IMAGE_HEIGHT);
  // 60% of a 412px page is a 247px window; at 2.18 px per CSS px that is ~540 capture px.
  assert.ok(p.source.width > 530 && p.source.width < 550, `source width ${p.source.width}`);
  assert.equal(Math.round(p.source.width / p.source.height * 100) / 100, Math.round(IMAGE_WIDTH / IMAGE_HEIGHT * 100) / 100,
    "the source keeps the output's proportions, so nothing is stretched");
});

test("the element is inside the picture, outlined, with the badge at its corner", () => {
  const p = imagePlan(BOX, PAGE, CAPTURE)!;
  assert.ok(p.outline.left >= 0 && p.outline.top >= 0);
  assert.ok(p.outline.left + p.outline.width <= p.width);
  assert.ok(p.outline.top + p.outline.height <= p.height);
  assert.ok(p.outline.width > 0 && p.outline.height > 0);
  assert.deepEqual(p.pin, { x: p.outline.left, y: p.outline.top });
});

test("an element at the very top shows the top edge rather than blank above it", () => {
  const p = imagePlan({ x: 0, y: 0, width: 200, height: 30 }, PAGE, CAPTURE)!;
  assert.equal(p.source.y, 0);
});

test("a finding below the stored image cannot be drawn", () => {
  assert.equal(imagePlan({ x: 0, y: 3000, width: 50, height: 20 }, PAGE, CAPTURE), null);
});

test("nothing is planned from a capture that has no size", () => {
  assert.equal(imagePlan(BOX, PAGE, { width: 0, height: 0 }), null);
  assert.equal(imagePlan(BOX, { width: 0, height: null }, CAPTURE), null);
});

test("a full-width element is shown whole, not cut to 60% of the page", () => {
  const p = imagePlan({ x: 0, y: 40, width: 412, height: 30 }, PAGE, CAPTURE)!;
  // The whole page width, at the capture's density.
  assert.equal(p.source.width, CAPTURE.width);
  assert.equal(p.outline.left, 0);
  assert.equal(p.outline.width, p.width);
});
