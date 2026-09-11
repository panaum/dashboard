import { test } from "node:test";
import assert from "node:assert/strict";
import { drawable, pinsFor, pinNumber, placePins, type PinSource } from "./pins";

const box = (y: number) => ({ x: 10, y, width: 40, height: 20 });
const item = (id: string, y: number | null, extra: Partial<PinSource> = {}): PinSource => ({
  id, severity: "error", box: y === null ? null : box(y), ...extra,
});

test("a finding with no box gets no pin", () => {
  assert.equal(drawable(item("a", null), 1000), false);
  assert.deepEqual(pinsFor([item("a", null)], 1000), []);
});

test("a page-level finding gets no pin even with a box", () => {
  assert.equal(drawable(item("a", 10, { pageLevel: true }), 1000), false);
});

test("a zero-sized box gets no pin", () => {
  assert.equal(drawable({ id: "a", severity: "warn", box: { x: 0, y: 0, width: 0, height: 10 } }, 1000), false);
});

test("numbers follow list order, worst first", () => {
  const pins = pinsFor([item("a", 500), item("b", 20), item("c", 300)], 1000);
  assert.deepEqual(pins.map((p) => [p.id, p.n]), [["a", 1], ["b", 2], ["c", 3]]);
});

test("a box below the stored image is skipped and does not consume a number", () => {
  const pins = pinsFor([item("a", 100), item("b", 5000), item("c", 200)], 1000);
  assert.deepEqual(pins.map((p) => [p.id, p.n]), [["a", 1], ["c", 2]]);
  assert.equal(pinNumber(pins, "b"), null);
  assert.equal(pinNumber(pins, "c"), 2);
});

test("no image height yet: every boxed finding still numbers", () => {
  const pins = pinsFor([item("a", 100), item("b", 5000)], null);
  assert.equal(pins.length, 2);
});

test("severity rides along, for the pin's colour", () => {
  const pins = pinsFor([{ id: "a", severity: "warn", box: box(10) }], null);
  assert.equal(pins[0].severity, "warn");
});

test("pins on different elements keep their measured spot", () => {
  const pins = pinsFor([item("a", 100), { id: "b", severity: "warn", box: { x: 200, y: 400, width: 10, height: 10 } }], null);
  const placed = placePins(pins, 1);
  assert.deepEqual(placed.map((p) => [p.left, p.top]), [[10, 100], [200, 400]]);
});

test("pins on the same element fan out instead of hiding each other", () => {
  const pins = pinsFor([item("a", 100), item("b", 100), item("c", 100)], null);
  const placed = placePins(pins, 1);
  assert.deepEqual(placed.map((p) => p.left), [10, 32, 54]);
  assert.deepEqual(placed.map((p) => p.top), [100, 100, 100]);
});

test("scale is applied before spacing, so the fan is in screen pixels", () => {
  const pins = pinsFor([item("a", 100), item("b", 100)], null);
  const placed = placePins(pins, 0.5);
  assert.deepEqual(placed.map((p) => [p.left, p.top]), [[5, 50], [27, 50]]);
});

test("far apart vertically is not a clash, however close horizontally", () => {
  const pins = pinsFor([item("a", 100), item("b", 400)], null);
  assert.deepEqual(placePins(pins, 1).map((p) => p.left), [10, 10]);
});

test("a crowded spot stops fanning rather than marching off the page", () => {
  const many = Array.from({ length: 20 }, (_, i) => item(`i${i}`, 100));
  const placed = placePins(pinsFor(many, null), 1);
  assert.ok(placed.every((p) => p.left <= 10 + 12 * 22));
});

test("a long run of pins on one element wraps instead of stacking at the edge", () => {
  // Eighteen findings on one element: 22px apart from x=8 they run past the
  // right edge of a 330px phone at the sixteenth, where the frame used to
  // clamp every remaining pin onto the same spot.
  const pins = Array.from({ length: 18 }, (_, i) => ({
    id: String(i), n: i + 1, severity: "warn" as const, box: { x: 8, y: 40, width: 60, height: 12 },
  }));
  const placed = placePins(pins, 1, 330);
  assert.ok(placed.every((p) => p.left <= 330 - 11), "no pin fans past the right edge");
  assert.equal(new Set(placed.map((p) => `${p.left},${p.top}`)).size, placed.length, "every pin has its own spot");
  assert.ok(new Set(placed.map((p) => p.top)).size > 1, "it wrapped to more than one row");
  assert.equal(placed[0].left, 8, "the first pin still sits where it was measured");
  assert.equal(placed[0].top, 40);

  // Without a width it is the old behaviour: one row, and once the run hits
  // its bound the rest share a spot — which is the thing wrapping avoids.
  const flat = placePins(pins, 1);
  assert.equal(new Set(flat.map((p) => p.top)).size, 1, "one row");
  assert.ok(new Set(flat.map((p) => p.left)).size < flat.length, "some pins share a spot");
});

test("without a width, fanning stays the single row it was", () => {
  const pins = Array.from({ length: 3 }, (_, i) => ({
    id: String(i), n: i + 1, severity: "warn" as const, box: { x: 100, y: 400, width: 10, height: 10 },
  }));
  const placed = placePins(pins, 1);
  assert.deepEqual(placed.map((p) => p.top), [400, 400, 400]);
  assert.deepEqual(placed.map((p) => p.left), [100, 122, 144]);
});
