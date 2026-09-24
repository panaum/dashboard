import { test } from "node:test";
import assert from "node:assert/strict";
import { makePreviewToken, readPreviewToken } from "./preview";
import { can } from "./permissions";

const KEY = "test-key";

test("a rank preview round-trips for its owner", () => {
  const t = makePreviewToken("admin1", { kind: "rank", rank: "VIEWER" }, KEY);
  assert.deepEqual(readPreviewToken(t, "admin1", KEY), { kind: "rank", rank: "VIEWER" });
});

test("a person preview round-trips for its owner", () => {
  const t = makePreviewToken("team", { kind: "member", memberId: "m42" }, KEY);
  assert.deepEqual(readPreviewToken(t, "team", KEY), { kind: "member", memberId: "m42" });
});

test("someone else's preview cookie does nothing", () => {
  const t = makePreviewToken("admin1", { kind: "rank", rank: "MEMBER" }, KEY);
  assert.equal(readPreviewToken(t, "admin2", KEY), null);
});

test("a tampered target or a wrong key is refused", () => {
  const t = makePreviewToken("admin1", { kind: "rank", rank: "VIEWER" }, KEY);
  assert.equal(readPreviewToken(t.replace("VIEWER", "MEMBER"), "admin1", KEY), null);
  assert.equal(readPreviewToken(t, "admin1", "other-key"), null);
  assert.equal(readPreviewToken(undefined, "admin1", KEY), null);
  assert.equal(readPreviewToken("garbage", "admin1", KEY), null);
});

test("admin is not a preview target, even with a valid signature", () => {
  // Forge the payload shape by hand with the right key: still refused.
  const t = makePreviewToken("admin1", { kind: "rank", rank: "VIEWER" }, KEY);
  const forged = makePreviewToken("admin1", { kind: "rank", rank: "ADMIN" as "VIEWER" }, KEY);
  assert.ok(readPreviewToken(t, "admin1", KEY));
  assert.equal(readPreviewToken(forged, "admin1", KEY), null);
});

test("a read-only actor holds no capability at all — the preview's server-side lock", () => {
  const actor = { id: "a", name: "A", rank: "ADMIN" as const, readOnly: true };
  assert.equal(can(actor, "issue:write"), false);
  assert.equal(can(actor, "team:view"), false);
  assert.equal(can({ ...actor, readOnly: false }, "team:view"), true);
});
