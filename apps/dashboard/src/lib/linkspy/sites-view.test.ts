import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildSitesList,
  buildScanView,
  bucketTone,
  STATE_TONE,
  STATE_LABEL,
  type RegistrySiteRow,
} from "./sites-view";
import { STATE_ORDER, type SitesPayload } from "./chips-shape";

const site = (id: string, url: string, clientName = "Acme"): RegistrySiteRow => ({
  id, url, clientName,
});

const chips = (states: Record<string, "critical" | "warn" | "ok">): SitesPayload => ({
  as_of: "t",
  chip_keys: ["ssl"],
  sites: Object.fromEntries(
    Object.entries(states).map(([id, state]) => [
      id,
      { site_path: `/dashboard/${id}`, worst: state, chips: [{ key: "ssl", state, label: "SSL", text: "x" }] },
    ]),
  ),
});

test("worst site sorts first; ties break on host for a stable order", () => {
  const rows = [site("a", "https://zeta.test"), site("b", "https://alpha.test"), site("c", "https://beta.test")];
  const out = buildSitesList(rows, chips({ a: "ok", b: "ok", c: "critical" }), new Map());
  assert.deepEqual(out.map((s) => s.id), ["c", "b", "a"]);
});

test("a site the chips payload does not know reads as unknown, not healthy", () => {
  const [only] = buildSitesList([site("a", "https://a.test")], chips({}), new Map());
  assert.equal(only.worst, "unknown");
  assert.deepEqual(only.chips, []);
});

test("null chips payload (LinkSpy unreachable) still lists sites", () => {
  const out = buildSitesList([site("a", "https://a.test")], null, new Map([["a", 3]]));
  assert.equal(out.length, 1);
  assert.equal(out[0].linkedPages, 3);
  assert.equal(out[0].host, "a.test");
});

test("every chip state has a tone and a label", () => {
  for (const s of STATE_ORDER) {
    assert.ok(STATE_TONE[s], `tone for ${s}`);
    assert.ok(STATE_LABEL[s], `label for ${s}`);
  }
});

test("unknown and settling never read green", () => {
  assert.notEqual(STATE_TONE.unknown, "success");
  assert.notEqual(STATE_TONE.settling, "success");
});

test("scan views: unavailable, no scan, clean, issues", () => {
  assert.deepEqual(buildScanView(null), { state: "unavailable" });
  assert.deepEqual(buildScanView({ no_scan: true }), { state: "no_scan" });
  const clean = buildScanView({ no_scan: false, scanned_at: "t", totals: { links: 5, ok: 5 }, flagged: [] });
  assert.equal(clean.state, "clean");
  const issues = buildScanView({
    no_scan: false, scanned_at: "t",
    totals: { links: 5, ok: 4, broken: 1 },
    flagged: [{ url: "u", bucket: "broken" }],
  });
  assert.equal(issues.state, "issues");
});

test("unverifiable-only results are flagged for review, not declared clean", () => {
  const v = buildScanView({
    no_scan: false,
    totals: { links: 2, ok: 1, unverifiable: 1 },
    flagged: [{ url: "u", bucket: "unverifiable" }],
  });
  assert.equal(v.state, "issues");
});

test("bucket tones: broken is error, dead CTA warns, anything else neutral", () => {
  assert.equal(bucketTone("broken"), "error");
  assert.equal(bucketTone("dead_cta"), "warning");
  assert.equal(bucketTone("unverifiable"), "neutral");
  assert.equal(bucketTone(undefined), "neutral");
});

test("incidents: unavailable, none, and a list with open count", async () => {
  const { buildIncidentsView } = await import("./sites-view");
  assert.deepEqual(buildIncidentsView(null), { state: "unavailable" });
  assert.deepEqual(buildIncidentsView({ incidents: [] }), { state: "none" });
  const v = buildIncidentsView({
    incidents: [
      { down_at: "2026-08-01T00:00:00Z", restored_at: null },
      { down_at: "2026-08-02T00:00:00Z", restored_at: "2026-08-02T02:14:00Z" },
    ],
    open: 1,
  });
  assert.equal(v.state, "list");
  if (v.state === "list") {
    assert.equal(v.open, 1);
    assert.equal(v.items[0].ongoing, true);
    assert.equal(v.items[0].duration, null, "ongoing windows carry no duration — no clock reads");
    assert.equal(v.items[1].duration, "2h 14m");
  }
});

test("window formatting: minutes, hours, days, garbage", async () => {
  const { formatWindow } = await import("./sites-view");
  assert.equal(formatWindow("2026-08-01T00:00:00Z", "2026-08-01T00:00:20Z"), "under a minute");
  assert.equal(formatWindow("2026-08-01T00:00:00Z", "2026-08-01T00:45:00Z"), "45m");
  assert.equal(formatWindow("2026-08-01T00:00:00Z", "2026-08-01T03:00:00Z"), "3h");
  assert.equal(formatWindow("2026-08-01T00:00:00Z", "2026-08-03T05:00:00Z"), "2d 5h");
  assert.equal(formatWindow("garbage", "2026-08-01T00:00:00Z"), null);
  assert.equal(formatWindow("2026-08-02T00:00:00Z", "2026-08-01T00:00:00Z"), null, "negative windows are data errors, not durations");
});

test("sites health rollup buckets worst states honestly", async () => {
  const { summarizeSitesHealth } = await import("./sites-view");
  const h = summarizeSitesHealth([
    { worst: "critical" }, { worst: "warn" }, { worst: "ok" },
    { worst: "settling" }, { worst: "unknown" }, { worst: "notice" },
  ]);
  assert.deepEqual(h, { total: 6, attention: 2, healthy: 1, quiet: 3 });
});

test("vitals: unavailable on null/empty, cards otherwise; every escalation has a tone", async () => {
  const { buildVitalsView, ESCALATION_TONE } = await import("./sites-view");
  assert.deepEqual(buildVitalsView(null), { state: "unavailable" });
  assert.deepEqual(buildVitalsView({ cards: [] }), { state: "unavailable" });
  const v = buildVitalsView({
    cards: [{ key: "ssl", label: "SSL", escalation: "warn", fact: "12 days" }],
    all_clear: false,
    last_checked: "t",
  });
  assert.equal(v.state, "cards");
  if (v.state === "cards") assert.equal(v.cards[0].fact, "12 days");
  for (const e of ["critical", "warn", "notice", "unknown", "ok"] as const) {
    assert.ok(ESCALATION_TONE[e], `tone for ${e}`);
  }
  assert.notEqual(ESCALATION_TONE.unknown, "success");
});

test("history: unavailable, none, series; points without a timestamp are dropped", async () => {
  const { buildHistoryView } = await import("./sites-view");
  assert.deepEqual(buildHistoryView(null), { state: "unavailable" });
  assert.deepEqual(buildHistoryView({ points: [] }), { state: "none" });
  const v = buildHistoryView({ points: [{ at: "t", health_score: 91 }, { health_score: 88 }] });
  assert.equal(v.state, "series");
  if (v.state === "series") assert.equal(v.points.length, 1);
});

test("health tones match LinkSpy's thresholds; missing scores stay neutral", async () => {
  const { healthTone } = await import("./sites-view");
  assert.equal(healthTone(95), "success");
  assert.equal(healthTone(90), "success");
  assert.equal(healthTone(75), "warning");
  assert.equal(healthTone(40), "error");
  assert.equal(healthTone(null), "neutral");
  assert.equal(healthTone(undefined), "neutral");
});
