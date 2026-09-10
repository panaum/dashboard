import { test } from "node:test";
import assert from "node:assert/strict";
import { auditedCount, reachKey, reachLabel, reachMap, reachTone, type ReachDevice } from "./reach";

const dev = (status: string, findings: ReachDevice["findings"]): ReachDevice => ({ status, findings });
const f = (rule: string, selector?: string, scope?: string) => ({ rule, selector, scope });

test("a page-level finding keys on the rule alone", () => {
  assert.equal(reachKey("cls", undefined, "page"), "cls|");
  assert.equal(reachKey("cls", "body", "page"), "cls|");
  assert.equal(reachKey("tap-small", "a.cta"), "tap-small|a.cta");
});

test("counts devices, not rows", () => {
  const m = reachMap([dev("ok", [f("tap-small", "a.cta"), f("tap-small", "a.cta")])]);
  assert.equal(m.get("tap-small|a.cta"), 1);
});

test("a device that failed to capture is not counted either way", () => {
  const devices = [dev("ok", [f("cls", undefined, "page")]), dev("blocked", [f("cls", undefined, "page")])];
  assert.equal(reachMap(devices).get("cls|"), 1);
  assert.equal(auditedCount(devices), 1);
});

test("the same rule on different selectors does not merge", () => {
  const m = reachMap([dev("ok", [f("tap-small", "a.one"), f("tap-small", "a.two")])]);
  assert.equal(m.get("tap-small|a.one"), 1);
  assert.equal(m.get("tap-small|a.two"), 1);
});

test("labels say what the number means", () => {
  assert.equal(reachLabel({ devices: 1, audited: 14 }), "only here");
  assert.equal(reachLabel({ devices: 9, audited: 14 }), "9 of 14 devices");
  assert.equal(reachLabel({ devices: 14, audited: 14 }), "all 14 devices");
});

test("one audited device says nothing — there is nothing to compare with", () => {
  assert.equal(reachLabel({ devices: 1, audited: 1 }), null);
  assert.equal(reachTone({ devices: 1, audited: 1 }), null);
  assert.equal(reachLabel(null), null);
});

test("tone separates a site-wide fix from a one-device quirk", () => {
  assert.equal(reachTone({ devices: 1, audited: 14 }), "narrow");
  assert.equal(reachTone({ devices: 9, audited: 14 }), "wide");
});
