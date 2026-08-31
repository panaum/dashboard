import { test } from "node:test";
import assert from "node:assert/strict";
import { buildStory, daysSince, type LiveVitals } from "./story-shape";

const NOW = new Date("2026-08-11T09:30:00.000Z");

const src = {
  pageName: "Fautons Homepage",
  clientName: "Fautons",
  signedOffAt: new Date("2026-02-12T14:05:00.000Z"),
};

test("counts whole UTC days since sign-off", () => {
  assert.equal(daysSince(new Date("2026-08-10T00:00:00Z"), NOW), 1);
  assert.equal(daysSince(new Date("2026-08-11T00:00:00Z"), NOW), 0);
  assert.equal(daysSince(new Date("2026-02-12T14:05:00Z"), NOW), 180);
});

// Calendar days, not elapsed hours: signed off late yesterday reads as 1 day,
// even though only a few hours have passed.
test("counts calendar days, not elapsed hours", () => {
  assert.equal(daysSince(new Date("2026-08-10T23:59:00Z"), NOW), 1);
});

// The server's timezone must not change the answer.
test("day count is timezone-independent", () => {
  const late = new Date("2026-08-10T22:00:00Z");
  const early = new Date("2026-08-10T02:00:00Z");
  assert.equal(daysSince(late, NOW), daysSince(early, NOW));
});

// A future sign-off is bad data; "-3 days since delivery" on a client's
// certificate is worse than "0".
test("clamps a future sign-off to zero rather than going negative", () => {
  assert.equal(daysSince(new Date("2026-12-01T00:00:00Z"), NOW), 0);
});

test("builds the header from the Dashboard's own fields", () => {
  const story = buildStory(src, NOW);
  assert.equal(story.page_name, "Fautons Homepage");
  assert.equal(story.client_name, "Fautons");
  assert.equal(story.delivered_on, "2026-02-12");
  assert.equal(story.days_since_delivery, 180);
});

// Not yet signed off is a normal state, not an error.
test("null sign-off yields null delivery fields, not zero", () => {
  const story = buildStory({ ...src, signedOffAt: null }, NOW);
  assert.equal(story.delivered_on, null);
  assert.equal(story.days_since_delivery, null);
});

test("an invalid date is treated as no sign-off", () => {
  const story = buildStory({ ...src, signedOffAt: new Date("nonsense") }, NOW);
  assert.equal(story.delivered_on, null);
  assert.equal(story.days_since_delivery, null);
});

// ═══ THE SECTION 1 SEAM — PER-SITE, NOT PER-CLIENT (F11) ═══
// The names carry the scope on purpose. A field called `uptime_pct` on a
// page-scoped payload would mislead every future reader of the contract.
test("vitals default to null so the renderer omits those clauses", () => {
  const story = buildStory(src, NOW);
  assert.equal(story.site_uptime_pct, null);
  assert.equal(story.site_incidents_handled, null);
  assert.equal(story.site_health, null);
});

test("the shape carries no client-scoped field", () => {
  const keys = Object.keys(buildStory(src, NOW));
  for (const banned of ["uptime_pct", "incidents_handled", "health"]) {
    assert.ok(!keys.includes(banned), `${banned} must not exist — scope must be explicit`);
  }
  assert.ok(keys.includes("site_uptime_pct"));
  assert.ok(keys.includes("site_incidents_handled"));
  assert.ok(keys.includes("site_health"));
});

test("vitals pass through unchanged once Section 1 supplies them", () => {
  const vitals: LiveVitals = {
    siteUptimePct: 99.8,
    siteIncidentsHandled: 3,
    siteHealth: "healthy",
  };
  const story = buildStory(src, NOW);
  const withVitals = buildStory(src, NOW, vitals);
  assert.equal(withVitals.site_uptime_pct, 99.8);
  assert.equal(withVitals.site_incidents_handled, 3);
  assert.equal(withVitals.site_health, "healthy");
  // Adding vitals must not disturb anything the Dashboard already answered.
  assert.equal(withVitals.page_name, story.page_name);
  assert.equal(withVitals.days_since_delivery, story.days_since_delivery);
});

// Zero is real data and must survive; only null means "no data".
test("zero incidents is data, not absence", () => {
  const story = buildStory(src, NOW, {
    siteUptimePct: 100,
    siteIncidentsHandled: 0,
    siteHealth: "healthy",
  });
  assert.equal(story.site_incidents_handled, 0);
  assert.notEqual(story.site_incidents_handled, null);
});

// Same inputs, same output — no clock read inside.
test("is deterministic", () => {
  assert.deepEqual(buildStory(src, NOW), buildStory(src, NOW));
});
