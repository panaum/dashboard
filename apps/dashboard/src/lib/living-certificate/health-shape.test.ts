import { test } from "node:test";
import assert from "node:assert/strict";
import { buildLiveHealth, siteHealthFrom, type ChipKey } from "./health-shape";
import type { LinkSpyStatusPayload, LinkSpyCheck } from "@/lib/linkspy/catalog-map";

const check = (
  key: string,
  verdict: LinkSpyCheck["verdict"],
  over: Partial<LinkSpyCheck> = {},
): LinkSpyCheck => ({
  key,
  verdict,
  detail_plain: "…",
  last_checked: "2026-08-04T04:43:35.000Z",
  incident_ref: null,
  ...over,
});

const payload = (checks: LinkSpyCheck[]): LinkSpyStatusPayload => ({
  mapped: true,
  as_of: "2026-08-04T04:43:35.000Z",
  checks,
});

const stateOf = (h: ReturnType<typeof buildLiveHealth>, k: ChipKey) =>
  h?.chips.find((c) => c.key === k)?.state;

// ═══ THE REAL PRODUCTION PAYLOAD ═══
// Copied from the one mapped LinkSpyStatus row (fetched 2026-08-04). Note what
// it does NOT contain: forms_submit, ga4_installed, pixel_present.
const REAL = payload([
  check("ssl_valid", "holding"),
  check("ssl_expiry", "holding"),
  check("domain_expiry", "holding"),
  check("uptime", "holding", { last_checked: null }), // no per-check timestamp
  check("broken_links", "failing"),
  check("page_load_time", "holding"),
]);

test("the real payload maps to four distinct states", () => {
  const h = buildLiveHealth(REAL);
  assert.ok(h);
  assert.equal(h.chips.length, 5);
  assert.equal(stateOf(h, "ssl"), "healthy");
  assert.equal(stateOf(h, "uptime"), "healthy");
  assert.equal(stateOf(h, "links"), "attention");
  assert.equal(stateOf(h, "forms"), "unknown");
  assert.equal(stateOf(h, "tracking"), "unknown");
});

// The candidate signal for a "settling" state. It is a HEALTHY check that simply
// carries no per-check timestamp — its detail reads "Reachable · 99.4% uptime".
// Treating it as anything but healthy would state a fault that does not exist.
test("uptime with a null last_checked is healthy, not settling", () => {
  const h = buildLiveHealth(payload([check("uptime", "holding", { last_checked: null })]));
  assert.equal(stateOf(h, "uptime"), "healthy");
});

// ═══ ABSENCE IS NEVER SUCCESS ═══
test("a chip with no check is unknown, never healthy", () => {
  const h = buildLiveHealth(payload([check("ssl_valid", "holding")]));
  for (const k of ["uptime", "forms", "tracking", "links"] as ChipKey[]) {
    assert.equal(stateOf(h, k), "unknown", `${k} must be unknown when absent`);
  }
});

test("couldnt_verify is unknown, never healthy", () => {
  const h = buildLiveHealth(payload([check("forms_submit", "couldnt_verify")]));
  assert.equal(stateOf(h, "forms"), "unknown");
});

// ═══ SEVERITY ═══
test("SSL and uptime failures are critical — a visitor is hurt right now", () => {
  const h = buildLiveHealth(
    payload([check("ssl_valid", "failing"), check("uptime", "failing")]),
  );
  assert.equal(stateOf(h, "ssl"), "critical");
  assert.equal(stateOf(h, "uptime"), "critical");
});

test("forms, tracking and links failures are attention — the site still works", () => {
  const h = buildLiveHealth(
    payload([
      check("forms_submit", "failing"),
      check("ga4_installed", "failing"),
      check("broken_links", "failing"),
    ]),
  );
  assert.equal(stateOf(h, "forms"), "attention");
  assert.equal(stateOf(h, "tracking"), "attention");
  assert.equal(stateOf(h, "links"), "attention");
});

test("an open incident escalates any failure to critical", () => {
  const h = buildLiveHealth(
    payload([check("broken_links", "failing", { incident_ref: "inc_123" })]),
  );
  assert.equal(stateOf(h, "links"), "critical");
});

test("the worst verdict wins when several checks feed one chip", () => {
  const h = buildLiveHealth(
    payload([check("ssl_valid", "holding"), check("ssl_expiry", "failing")]),
  );
  assert.equal(stateOf(h, "ssl"), "critical");
});

// ═══ F10 — NOTHING FROM LINKSPY CROSSES ═══
test("no LinkSpy text, id or reference reaches the output", () => {
  const h = buildLiveHealth(
    payload([
      check("ssl_valid", "holding", { detail_plain: "SSL valid · 52 days remaining." }),
      check("broken_links", "failing", {
        detail_plain: "1 broken link on this page.",
        incident_ref: "inc_secret_42",
      }),
    ]),
  );
  const json = JSON.stringify(h);
  assert.doesNotMatch(json, /52 days remaining/, "detail_plain must not cross");
  assert.doesNotMatch(json, /1 broken link/, "detail_plain must not cross");
  assert.doesNotMatch(json, /inc_secret_42/, "incident refs must not cross");
  assert.doesNotMatch(json, /detail_plain|incident_ref|catalog_version/, "no raw keys");
});

test("the note is our wording, keyed to the state", () => {
  const h = buildLiveHealth(payload([check("ssl_valid", "holding")]));
  assert.equal(h?.chips.find((c) => c.key === "ssl")?.note, "Valid");
  assert.equal(h?.chips.find((c) => c.key === "forms")?.note, "Not checked");
});

// ═══ UNMAPPED ═══
// 17 of 18 cached rows are {mapped:false}. An unmapped page is not an unhealthy
// one — five grey chips would imply we looked and found nothing.
test("an unmapped page yields no strip at all", () => {
  assert.equal(buildLiveHealth({ mapped: false }), null);
  assert.equal(buildLiveHealth(null), null);
  assert.equal(buildLiveHealth(undefined), null);
});

test("a mapped page with no checks still renders five unknown chips", () => {
  const h = buildLiveHealth({ mapped: true, checks: [] });
  assert.ok(h);
  assert.equal(h.chips.length, 5);
  assert.ok(h.chips.every((c) => c.state === "unknown"));
});

test("garbage checks never throw", () => {
  assert.doesNotThrow(() =>
    buildLiveHealth({ mapped: true, checks: [null, { key: 1 }, {}] as never }),
  );
});

test("staleness is carried, not hidden", () => {
  const h = buildLiveHealth(REAL, { stale: true, asOf: "2026-08-01T00:00:00.000Z" });
  assert.equal(h?.stale, true);
  assert.equal(h?.as_of, "2026-08-01T00:00:00.000Z");
});

// ═══ THE HEADER AND THE STRIP CANNOT DISAGREE ═══
test("site health is derived from the same chips", () => {
  assert.equal(siteHealthFrom(buildLiveHealth(REAL)), "attention"); // links failing
  assert.equal(
    siteHealthFrom(buildLiveHealth(payload([check("ssl_valid", "holding")]))),
    "healthy",
  );
  assert.equal(
    siteHealthFrom(buildLiveHealth(payload([check("ssl_valid", "couldnt_verify")]))),
    "unknown",
  );
});

test("no strip means no health claim in the header", () => {
  assert.equal(siteHealthFrom(null), null);
});

test("is deterministic", () => {
  assert.deepEqual(buildLiveHealth(REAL), buildLiveHealth(REAL));
});
