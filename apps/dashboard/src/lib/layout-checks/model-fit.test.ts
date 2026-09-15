import { test } from "node:test";
import assert from "node:assert/strict";
import { cameraDistance } from "./model-fit";

// The Galaxy S25 model's bounding box, in model units.
const S25 = { width: 2.2532, height: 4.6808, depth: 0.3002 };

// The share of the canvas height the model's front face takes from distance d.
const heightShare = (d: number, fov: number) =>
  S25.height / 2 / ((d - S25.depth / 2) * Math.tan((fov * Math.PI) / 360));

test("a box taller than the handset's shape is filled to the requested height", () => {
  const d = cameraDistance(S25, 22, 1, 0.86);
  assert.ok(Math.abs(heightShare(d, 22) - 0.86) < 1e-9);
});

test("a box narrower than the handset's shape is limited by width instead", () => {
  const narrow = cameraDistance(S25, 22, 0.3, 0.86);
  const square = cameraDistance(S25, 22, 1, 0.86);
  assert.ok(narrow > square, "a narrow box has to stand the camera further back");
  assert.ok(heightShare(narrow, 22) < 0.86, "so the height is no longer the tight side");
});

test("turning the handset cannot push it out of the box: width counts the depth", () => {
  const flat = cameraDistance({ ...S25, depth: 0 }, 22, 0.3, 0.86);
  const deep = cameraDistance(S25, 22, 0.3, 0.86);
  assert.ok(deep > flat);
});

test("nothing sensible to fit gives a distance of zero rather than NaN or Infinity", () => {
  assert.equal(cameraDistance(S25, 22, 0, 0.86), 0);
  assert.equal(cameraDistance(S25, 0, 1, 0.86), 0);
  assert.equal(cameraDistance({ width: 0, height: 0, depth: 0 }, 22, 1, 0.86), 0);
  assert.equal(cameraDistance(S25, 22, Number.NaN, 0.86), 0);
});
