import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPageWhere, hasAnyFilter } from "./page-search";

// ─── buildPageWhere ───────────────────────────────────────────────────────────

test("no params produces an empty filter (matches everything)", () => {
  assert.deepEqual(buildPageWhere({}), {});
});

test("a query searches name / project / client, case-insensitively", () => {
  assert.deepEqual(buildPageWhere({ q: "savvio" }), {
    OR: [
      { name: { contains: "savvio", mode: "insensitive" } },
      { project: { name: { contains: "savvio", mode: "insensitive" } } },
      { project: { client: { name: { contains: "savvio", mode: "insensitive" } } } },
    ],
  });
});

test("the query is trimmed; a blank query adds no OR clause", () => {
  assert.deepEqual(buildPageWhere({ q: "  savvio  " }).OR, [
    { name: { contains: "savvio", mode: "insensitive" } },
    { project: { name: { contains: "savvio", mode: "insensitive" } } },
    { project: { client: { name: { contains: "savvio", mode: "insensitive" } } } },
  ]);
  assert.deepEqual(buildPageWhere({ q: "   " }), {});
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

test("query and platform combine without clobbering each other", () => {
  const where = buildPageWhere({ q: "lp", platform: "UNBOUNCE" });
  assert.ok(Array.isArray(where.OR), "keeps the text OR clause");
  assert.deepEqual(where.project, { platform: "UNBOUNCE" });
});

// ─── hasAnyFilter ─────────────────────────────────────────────────────────────

test("hasAnyFilter is false for empty or blank-only params", () => {
  assert.equal(hasAnyFilter({}), false);
  assert.equal(hasAnyFilter({ q: "" }), false);
});

test("hasAnyFilter is true when any field is set", () => {
  assert.equal(hasAnyFilter({ q: "x" }), true);
  assert.equal(hasAnyFilter({ platform: "WIX" }), true);
  assert.equal(hasAnyFilter({ month: "2026-01" }), true);
  assert.equal(hasAnyFilter({ developerId: "d1" }), true);
});
