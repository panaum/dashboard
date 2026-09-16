import { test } from "node:test";
import assert from "node:assert/strict";
import { serviceLine } from "./service-line";

const HEALTH = { commit: "65a86f3b2c1d4e5f6a7b8c9d0e1f2a3b4c5d6e7f", devices: { count: 15, digest: "37c366b9c720" } };

test("the same build as the page is said in those words", () => {
  assert.equal(serviceLine(HEALTH, "65a86f3b2c1d4e5f6a7b8c9d0e1f2a3b4c5d6e7f"),
    "Preview service: running 65a86f3, the same build as this page · 15 device profiles loaded.");
});

test("a different build names both, because that is the thing worth seeing", () => {
  const line = serviceLine(HEALTH, "b38b0ca11111111111111111111111111111111");
  assert.match(line ?? "", /running 65a86f3; this page is on b38b0ca/);
});

test("without the page's own commit it still says what the service runs", () => {
  for (const mine of [null, undefined, "", "   "]) {
    assert.equal(serviceLine(HEALTH, mine),
      "Preview service: running 65a86f3 · 15 device profiles loaded.", String(mine));
  }
});

test("a service that reports no commit is not given one", () => {
  const line = serviceLine({ commit: null, devices: { count: 15 } }, "65a86f3b2c1d");
  assert.equal(line, "Preview service: running an unknown build — it reports no commit · 15 device profiles loaded.");
});

test("a device list that could not be read is said, not counted", () => {
  const line = serviceLine({ commit: "65a86f3b", devices: { error: "ENOENT" } }, null);
  assert.match(line ?? "", /its device list could not be read/);
  assert.doesNotMatch(line ?? "", /profiles loaded/);
});

test("no answer from the service says so, and says what it does not affect", () => {
  assert.match(serviceLine({ unavailable: true }) ?? "", /did not answer/);
  assert.match(serviceLine({ unavailable: true }) ?? "", /already stored are unaffected/);
});

test("nothing is claimed before there is an answer", () => {
  assert.equal(serviceLine(null), null);
  assert.equal(serviceLine(undefined), null);
});
