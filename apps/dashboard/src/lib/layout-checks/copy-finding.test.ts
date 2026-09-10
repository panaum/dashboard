import { test } from "node:test";
import assert from "node:assert/strict";
import { allFindingsText, findingText, type CopyFinding } from "./copy-finding";

const base: CopyFinding = {
  label: "Tap target 77 × 14", severity: "warn", selector: "a.cta", where: "Samsung Galaxy S25 · Chromium · 412 × 892",
  message: "a.cta is 77×14px, under the 24px minimum", why: "A fingertip covers what it presses.", fix: "Add padding.", pin: 3,
};

test("a finding carries device, element, measurement, why, fix and the page", () => {
  const t = findingText(base, "https://example.com/x");
  assert.equal(t.split("\n")[0], "#3 [Warning] Tap target 77 × 14");
  assert.match(t, /Where: Samsung Galaxy S25 · Chromium · 412 × 892/);
  assert.match(t, /Element: a\.cta/);
  assert.match(t, /Measured: a\.cta is 77×14px/);
  assert.match(t, /Why it matters: A fingertip/);
  assert.match(t, /Usual fix: Add padding\./);
  assert.match(t, /Page: https:\/\/example\.com\/x/);
});

test("no pin, no number in the heading", () => {
  assert.equal(findingText({ ...base, pin: null }, "u").split("\n")[0], "[Warning] Tap target 77 × 14");
});

test("a page-level finding says so instead of naming an element", () => {
  assert.match(findingText({ ...base, pageLevel: true, selector: null }, "u"), /Element: whole page/);
});

test("a message identical to the label is not repeated", () => {
  assert.doesNotMatch(findingText({ ...base, message: base.label }, "u"), /Measured:/);
});

test("missing explanation lines are left out, not written empty", () => {
  const t = findingText({ label: "X", selector: null, where: "w" }, "u");
  assert.doesNotMatch(t, /Why it matters:/);
  assert.doesNotMatch(t, /Usual fix:/);
  assert.equal(t.split("\n")[0], "X");
});

test("all findings: one heading, one page line at the end", () => {
  const t = allFindingsText([base, { ...base, pin: 4, label: "Text 11px" }], "https://e.com", "Samsung Galaxy S25");
  assert.match(t, /^Samsung Galaxy S25 — 2 findings/);
  assert.equal(t.match(/Page: https:\/\/e\.com/g)?.length, 1);
  assert.match(t, /#4 \[Warning\] Text 11px/);
});

test("all findings: nothing to fix still names the page", () => {
  const t = allFindingsText([], "https://e.com", "iPhone 16");
  assert.match(t, /Nothing to fix/);
  assert.match(t, /Page: https:\/\/e\.com/);
});
