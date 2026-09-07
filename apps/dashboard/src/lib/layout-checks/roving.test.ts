import { test } from "node:test";
import assert from "node:assert/strict";
import { rovingTarget } from "@/lib/layout-checks/roving";

test("arrows move one step, in both axes", () => {
  assert.equal(rovingTarget("ArrowRight", 0, 5), 1);
  assert.equal(rovingTarget("ArrowDown", 0, 5), 1, "a wrapped picker is a grid, so down is next");
  assert.equal(rovingTarget("ArrowLeft", 3, 5), 2);
  assert.equal(rovingTarget("ArrowUp", 3, 5), 2);
});

test("movement wraps at both ends", () => {
  assert.equal(rovingTarget("ArrowRight", 4, 5), 0);
  assert.equal(rovingTarget("ArrowLeft", 0, 5), 4);
});

test("Home and End go to the ends", () => {
  assert.equal(rovingTarget("Home", 3, 5), 0);
  assert.equal(rovingTarget("End", 1, 5), 4);
});

test("keys the picker does not own are left alone", () => {
  for (const k of ["Tab", "Enter", " ", "a", "Escape", "PageDown"]) {
    assert.equal(rovingTarget(k, 1, 5), null, k);
  }
});

test("an empty or single picker cannot move anywhere silly", () => {
  assert.equal(rovingTarget("ArrowRight", 0, 0), null);
  assert.equal(rovingTarget("End", 0, 0), null);
  assert.equal(rovingTarget("ArrowRight", 0, 1), 0);
  assert.equal(rovingTarget("ArrowLeft", 0, 1), 0);
});

test("a current index outside the list is clamped, not trusted", () => {
  assert.equal(rovingTarget("ArrowRight", 99, 5), 0, "clamped to the last, then wraps");
  assert.equal(rovingTarget("ArrowRight", -3, 5), 1, "clamped to the first");
});
