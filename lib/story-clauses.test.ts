import { test } from "node:test";
import assert from "node:assert/strict";
import { storyClauses, plural } from "./story-clauses.ts";
import type { Story } from "./living-certificate.ts";

// Runs on Node's built-in type stripping — no test framework, no bundler, no
// new dependency in this repo:  npm test
//
// This is why the null-omission rule lives in a .ts module rather than inside
// StoryHeader.tsx: JSX cannot be stripped, plain types can.

const base: Story = {
  page_name: "Fautons Homepage",
  client_name: "Fautons",
  delivered_on: "2026-02-12",
  days_since_delivery: 180,
  uptime_pct: null,
  incidents_handled: null,
  health: null,
};

test("today's state — only the Dashboard's own field is known", () => {
  assert.deepEqual(storyClauses(base), ["180 days since delivery"]);
});

test("the full line once Section 1 supplies the vitals", () => {
  assert.deepEqual(
    storyClauses({ ...base, uptime_pct: 99.8, incidents_handled: 3, health: "healthy" }),
    ["180 days since delivery", "99.8% uptime", "3 incidents handled"],
  );
});

// ═══ THE LOAD-BEARING RULE ═══
// A null must vanish. Rendering it as 0 would claim "0% uptime" — a false and
// alarming statement — on a client's certificate.
test("null vitals are dropped, never rendered as zero", () => {
  const clauses = storyClauses(base);
  assert.equal(clauses.length, 1);
  assert.ok(!clauses.some((c) => c.includes("0%")), "must not invent an uptime figure");
  assert.ok(!clauses.some((c) => c.includes("incident")), "must not invent an incident count");
});

// Zero is a real, and good, measurement. It must survive.
test("zero incidents is stated, not dropped", () => {
  assert.deepEqual(storyClauses({ ...base, incidents_handled: 0 }), [
    "180 days since delivery",
    "0 incidents handled",
  ]);
});

test("100% uptime is stated", () => {
  assert.deepEqual(storyClauses({ ...base, uptime_pct: 100 }), [
    "180 days since delivery",
    "100% uptime",
  ]);
});

// Not yet signed off: the header still renders, just without a delivery age.
test("an unsigned certificate yields no clauses at all", () => {
  assert.deepEqual(storyClauses({ ...base, delivered_on: null, days_since_delivery: null }), []);
});

test("delivered today reads as 0 days, not as absent", () => {
  assert.deepEqual(storyClauses({ ...base, days_since_delivery: 0 }), ["0 days since delivery"]);
});

test("singulars are singular", () => {
  assert.deepEqual(storyClauses({ ...base, days_since_delivery: 1, incidents_handled: 1 }), [
    "1 day since delivery",
    "1 incident handled",
  ]);
  assert.equal(plural(1, "day", "days"), "1 day");
  assert.equal(plural(2, "day", "days"), "2 days");
  assert.equal(plural(0, "day", "days"), "0 days");
});

test("clause order is stable", () => {
  const full = { ...base, uptime_pct: 99.8, incidents_handled: 3 };
  assert.deepEqual(storyClauses(full), storyClauses(full));
  assert.equal(storyClauses(full)[0], "180 days since delivery");
});
