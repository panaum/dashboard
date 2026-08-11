import { test } from "node:test";
import assert from "node:assert/strict";
import { storyClauses, scopeNote, plural } from "./story-clauses.ts";
import type { Story } from "./living-certificate.ts";

// Runs on Node's built-in type stripping — no test framework, no bundler, no
// new dependency in this repo:  npm test

const base: Story = {
  page_name: "Fautons LP",
  client_name: "Fautons",
  delivered_on: "2026-07-28",
  days_since_delivery: 14,
  site_uptime_pct: null,
  site_incidents_handled: null,
  site_health: null,
};

// ═══ GOLDEN SNAPSHOTS ═══
// Literal expected strings, so any future copy edit has to be deliberate.

test("snapshot — today: only the Dashboard's own field is known", () => {
  assert.deepEqual(storyClauses(base), ["14 days since delivery"]);
  assert.equal(scopeNote(base), null, "no site figure ⇒ no scope sentence");
});

test("snapshot — site health only (what Section 1 actually delivers today)", () => {
  const s = { ...base, site_health: "healthy" as const };
  assert.deepEqual(storyClauses(s), ["14 days since delivery"]);
  assert.equal(scopeNote(s), "Live figures cover the site this page is published on.");
});

test("snapshot — the full line, once a per-site uptime figure exists", () => {
  const s = { ...base, site_uptime_pct: 99.8, site_incidents_handled: 3, site_health: "healthy" as const };
  assert.deepEqual(storyClauses(s), [
    "14 days since delivery",
    "99.8% site uptime",
    "3 site incidents handled",
  ]);
  assert.equal(scopeNote(s), "Live figures cover the site this page is published on.");
});

// ═══ SCOPE HONESTY (F11) ═══
// The rule the reword exists for: a live figure may never appear without its
// scope being stated.
test("any site-scoped figure forces the scope sentence to render", () => {
  const cases: Partial<Story>[] = [
    { site_uptime_pct: 99.8 },
    { site_incidents_handled: 0 },
    { site_health: "healthy" },
    { site_health: "attention" },
    { site_uptime_pct: 100, site_incidents_handled: 2, site_health: "healthy" },
  ];
  for (const over of cases) {
    const s = { ...base, ...over };
    assert.notEqual(scopeNote(s), null, `scope must render for ${JSON.stringify(over)}`);
  }
});

test("every site-scoped clause names the site in its own words", () => {
  const s = { ...base, site_uptime_pct: 99.8, site_incidents_handled: 3 };
  for (const clause of storyClauses(s).slice(1)) {
    assert.match(clause, /site/, `"${clause}" must name its scope`);
  }
});

// The page-level clause is genuinely page-level and must NOT be mislabelled.
test("the delivery age is not labelled as a site figure", () => {
  assert.equal(storyClauses(base)[0], "14 days since delivery");
  assert.doesNotMatch(storyClauses(base)[0], /site/);
});

// ═══ NO CLIENT-ESTATE VOCABULARY ═══
test("no rendered string implies the client's other properties", () => {
  const s = { ...base, site_uptime_pct: 99.8, site_incidents_handled: 3, site_health: "healthy" as const };
  const rendered = [...storyClauses(s), scopeNote(s) ?? ""].join(" ");
  assert.doesNotMatch(rendered, /\b(all|every|your)\s+(sites?|properties)\b/i);
  assert.doesNotMatch(rendered, /estate/i);
  assert.doesNotMatch(rendered, /\bacross\b/i);
});

// ═══ NULL STILL VANISHES, UNDER THE RENAMED FIELDS ═══
test("null vitals are dropped, never rendered as zero", () => {
  const clauses = storyClauses(base);
  assert.equal(clauses.length, 1);
  assert.ok(!clauses.some((c) => c.includes("0%")), "must not invent an uptime figure");
  assert.ok(!clauses.some((c) => c.includes("incident")), "must not invent an incident count");
});

test("zero incidents is stated, not dropped", () => {
  assert.deepEqual(storyClauses({ ...base, site_incidents_handled: 0 }), [
    "14 days since delivery",
    "0 site incidents handled",
  ]);
});

test("100% uptime is stated", () => {
  assert.deepEqual(storyClauses({ ...base, site_uptime_pct: 100 }), [
    "14 days since delivery",
    "100% site uptime",
  ]);
});

test("an unsigned certificate yields no clauses at all", () => {
  assert.deepEqual(storyClauses({ ...base, delivered_on: null, days_since_delivery: null }), []);
});

test("delivered today reads as 0 days, not as absent", () => {
  assert.deepEqual(storyClauses({ ...base, days_since_delivery: 0 }), ["0 days since delivery"]);
});

test("singulars are singular", () => {
  assert.deepEqual(
    storyClauses({ ...base, days_since_delivery: 1, site_incidents_handled: 1 }),
    ["1 day since delivery", "1 site incident handled"],
  );
  assert.equal(plural(1, "day", "days"), "1 day");
  assert.equal(plural(2, "day", "days"), "2 days");
  assert.equal(plural(0, "day", "days"), "0 days");
});

test("clause order is stable", () => {
  const full = { ...base, site_uptime_pct: 99.8, site_incidents_handled: 3 };
  assert.deepEqual(storyClauses(full), storyClauses(full));
  assert.equal(storyClauses(full)[0], "14 days since delivery");
});
