import { test } from "node:test";
import assert from "node:assert/strict";

import { QA_TEMPLATE } from "../qa-template";
import { ITEM_MAP } from "./catalog-map";
import {
  type Finding,
  MAPPED_ITEM_NAMES,
  byItemName,
  proposalsFromPagecheck,
  proposalsFromSweep,
  toFindings,
} from "./pagecheck-map";

const f = (id: string, status: Finding["status"], detail = ""): Finding => ({
  id, status, title: id, detail,
});

const RENDER_OK = [f("overflow", "PASS"), f("edge", "PASS"), f("clipped", "PASS"), f("overlap", "PASS")];

// ── the guard that matters most ────────────────────────────────────────────

test("every mapped name exists in the checklist template", () => {
  const names = new Set(QA_TEMPLATE.flatMap((g) => g.items.map((i) => i.name)));
  for (const n of MAPPED_ITEM_NAMES) {
    assert.ok(names.has(n), `"${n}" is not a checklist item — a rename would silently stop proposals`);
  }
});

test("no mapped item is already claimed by the LinkSpy catalog", () => {
  const claimed = new Set(Object.values(ITEM_MAP));
  for (const n of MAPPED_ITEM_NAMES) {
    assert.ok(!claimed.has(n), `"${n}" is already sourced by ITEM_MAP — two machines would fight over one row`);
  }
});

// ── honesty rules ──────────────────────────────────────────────────────────

test("a clean sweep proposes a pass on the Chrome row", () => {
  const [p] = proposalsFromSweep(RENDER_OK);
  assert.equal(p.itemName, "Browser Test — Chrome");
  assert.equal(p.verdict, "holding");
});

test("any failure fails the row", () => {
  const [p] = proposalsFromSweep([f("overflow", "FAIL", "scrolls sideways"), f("clipped", "PASS"), f("overlap", "PASS")]);
  assert.equal(p.verdict, "failing");
  assert.match(p.detail, /scrolls sideways/);
});

test("a warning never becomes a pass — it needs eyes on the screenshots", () => {
  const [p] = proposalsFromSweep([f("overflow", "PASS"), f("clipped", "WARN", "text may be cut"), f("overlap", "PASS")]);
  assert.equal(p.verdict, "couldnt_verify");
});

test("a skipped check cannot pass the row either", () => {
  const [p] = proposalsFromSweep([f("overflow", "SKIP"), f("clipped", "PASS"), f("overlap", "PASS")]);
  assert.equal(p.verdict, "couldnt_verify");
});

test("a sweep with no render findings proposes nothing at all", () => {
  assert.deepEqual(proposalsFromSweep([f("cta", "INFO")]), []);
  assert.deepEqual(proposalsFromSweep([]), []);
});

test("CTA position is never mapped — where a button sits is not whether it works", () => {
  const props = proposalsFromSweep([...RENDER_OK, f("cta", "INFO")]);
  assert.equal(props.length, 1);
  assert.ok(!props.some((p) => p.itemName === "All CTA buttons work"));
});

// ── pagecheck side ─────────────────────────────────────────────────────────

test("attribution and placeholder each map to their own row", () => {
  const props = proposalsFromPagecheck([f("attribution", "PASS"), f("placeholder", "PASS")]);
  assert.deepEqual(props.map((p) => p.itemName).sort(),
    ["Hidden Fields Added", "No Dummy Copy / Video / Images"]);
  assert.ok(props.every((p) => p.verdict === "holding"));
});

test("a missing attribution field fails the hidden-fields row with the reason", () => {
  const [p] = proposalsFromPagecheck([f("attribution", "FAIL", "no field for gclid, fbclid")]);
  assert.equal(p.itemName, "Hidden Fields Added");
  assert.equal(p.verdict, "failing");
  assert.match(p.detail, /gclid/);
});

test("pagecheck findings with no honest equivalent are ignored", () => {
  const props = proposalsFromPagecheck([
    f("captcha", "WARN"), f("consent", "PASS"), f("endpoint", "PASS"), f("tracking", "PASS"),
  ]);
  assert.deepEqual(props, []);
});

test("a clean run still carries a readable detail, not an empty string", () => {
  const [p] = proposalsFromSweep(RENDER_OK);
  assert.ok(p.detail.length > 20);
  assert.doesNotMatch(p.detail, /undefined/);
});

// ── merging ────────────────────────────────────────────────────────────────

test("byItemName keys proposals and lets the later source win", () => {
  const merged = byItemName([
    { itemName: "Hidden Fields Added", verdict: "couldnt_verify", detail: "older" },
    { itemName: "Hidden Fields Added", verdict: "failing", detail: "newer" },
  ]);
  assert.equal(merged["Hidden Fields Added"].detail, "newer");
  assert.equal(Object.keys(merged).length, 1);
});

// ── normalising the two engines' shapes ────────────────────────────────────

test("the capture run's checks/name shape normalises", () => {
  const out = toFindings([{ id: "attribution", name: "Attribution population", status: "FAIL", detail: "no gclid" }]);
  assert.deepEqual(out, [{ id: "attribution", status: "FAIL", title: "Attribution population", detail: "no gclid" }]);
});

test("the sweep's findings/title shape normalises", () => {
  const out = toFindings([{ id: "overflow", title: "Horizontal overflow", status: "PASS" }]);
  assert.equal(out[0].title, "Horizontal overflow");
  assert.equal(out[0].detail, undefined);
});

test("lowercase status is accepted, unknown status is dropped", () => {
  assert.equal(toFindings([{ id: "a", status: "pass" }])[0].status, "PASS");
  assert.deepEqual(toFindings([{ id: "a", status: "weird" }]), []);
});

test("junk is dropped rather than guessed", () => {
  assert.deepEqual(toFindings(null), []);
  assert.deepEqual(toFindings("nope"), []);
  assert.deepEqual(toFindings([null, 3, {}, { status: "PASS" }, { id: "x" }]), []);
});

test("a finding with no title or name falls back to its id", () => {
  assert.equal(toFindings([{ id: "overflow", status: "PASS" }])[0].title, "overflow");
});

test("normalised capture output feeds the mapper end to end", () => {
  const props = proposalsFromPagecheck(toFindings([
    { id: "attribution", name: "Attribution population", status: "PASS" },
    { id: "placeholder", name: "Placeholder content", status: "FAIL", detail: "lorem ipsum found" },
    { id: "tracking", name: "Tracking inventory", status: "PASS" },
  ]));
  assert.equal(props.length, 2);
  assert.equal(props.find((p) => p.itemName === "Hidden Fields Added")?.verdict, "holding");
  const dummy = props.find((p) => p.itemName === "No Dummy Copy / Video / Images");
  assert.equal(dummy?.verdict, "failing");
  assert.match(dummy!.detail, /lorem ipsum/);
});

test("content cut off at the viewport edge cannot leave the Chrome row passing", () => {
  const [p] = proposalsFromSweep([
    f("overflow", "PASS"),
    f("edge", "WARN", "an image runs 35px past the viewport and is clipped"),
    f("clipped", "PASS"),
    f("overlap", "PASS"),
  ]);
  assert.equal(p.verdict, "couldnt_verify");
  assert.match(p.detail, /35px/);
});
