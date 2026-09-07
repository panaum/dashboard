import { test } from "node:test";
import assert from "node:assert/strict";
import { ms, REDUCE_QUERY, reducedMotion } from "@/lib/layout-checks/motion";

const on = (q: string) => ({ matches: q === REDUCE_QUERY });
const off = () => ({ matches: false });

test("the setting is read, not guessed", () => {
  assert.equal(reducedMotion(on), true);
  assert.equal(reducedMotion(off), false);
});

test("no window and a broken matchMedia both mean no claim", () => {
  assert.equal(reducedMotion(null), false, "server render animates nothing anyway");
  assert.equal(reducedMotion(() => { throw new Error("no"); }), false);
});

test("durations collapse to zero, and only then", () => {
  assert.equal(ms(150, on), 0);
  assert.equal(ms(150, off), 150);
  assert.equal(ms(0, off), 0);
});
