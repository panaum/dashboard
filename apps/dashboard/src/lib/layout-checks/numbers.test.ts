import { test } from "node:test";
import assert from "node:assert/strict";
import { numbersLine } from "./numbers";

// A real finding: the 20 × 20 icon button on the tap-inline fixture.
const BUTTON = { fontSize: "11px", fontWeight: "400", padding: "0px", minHeight: "15px", minWidth: "0px", width: "20px", height: "20px", display: "inline-block" };

test("the numbers read in the order a developer changes them, with the box last", () => {
  assert.equal(numbersLine(BUTTON), "font-size 11px · padding 0px · min-height 15px · min-width 0px · inline-block · 20×20px");
});

test("a default weight says nothing; a set one does", () => {
  assert.doesNotMatch(numbersLine(BUTTON) ?? "", /weight/);
  assert.match(numbersLine({ ...BUTTON, fontWeight: "700" }) ?? "", /weight 700/);
});

test("what the audit left out stays out", () => {
  assert.equal(numbersLine({ fontSize: "16px" }), "font-size 16px");
  assert.equal(numbersLine({}), null);
  assert.equal(numbersLine(null), null);
  assert.equal(numbersLine(undefined), null);
});
