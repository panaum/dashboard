import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPageWhere, hasAnyFilter } from "./page-search";

// ─── buildPageWhere ───────────────────────────────────────────────────────────
// Free-text search was removed; the dropdown filters are the whole surface now.

test("no params produces an empty filter (matches everything)", () => {
  assert.deepEqual(buildPageWhere({}), {});
});

test("scalar filters map straight through", () => {
  assert.deepEqual(
    buildPageWhere({ status: "LIVE", developerId: "d1", testerId: "t1", month: "2026-01" }),
    { status: "LIVE", developerId: "d1", deliveryMonth: "2026-01", testerId: "t1" },
  );
});

test("platform is nested under project", () => {
  assert.deepEqual(buildPageWhere({ platform: "WEBFLOW" }), {
    project: { platform: "WEBFLOW" },
  });
});

test("platform combines with a scalar filter without clobbering", () => {
  const where = buildPageWhere({ status: "LIVE", platform: "UNBOUNCE" });
  assert.equal(where.status, "LIVE");
  assert.deepEqual(where.project, { platform: "UNBOUNCE" });
});

// ─── hasAnyFilter ─────────────────────────────────────────────────────────────

test("hasAnyFilter is false for empty params", () => {
  assert.equal(hasAnyFilter({}), false);
});

test("hasAnyFilter is true when any dropdown is set", () => {
  assert.equal(hasAnyFilter({ platform: "WIX" }), true);
  assert.equal(hasAnyFilter({ status: "LIVE" }), true);
  assert.equal(hasAnyFilter({ month: "2026-01" }), true);
  assert.equal(hasAnyFilter({ developerId: "d1" }), true);
  assert.equal(hasAnyFilter({ testerId: "t1" }), true);
});
