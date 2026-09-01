import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cleanStreakDays,
  fixedThisMonth,
  sortSites,
  statusChip,
  scoreDelta,
  issueLine,
  displayName,
  middleTruncate,
  relativeTime,
  sparkScores,
  bandChip,
  type DashboardSite,
  type DashboardScan,
} from "./monitor-metrics";

const NOW = Date.parse("2026-08-31T12:00:00Z");

let seq = 0;
const scan = (at: string, broken = 0, dead = 0, health = 100): DashboardScan => ({
  id: `s${seq++}`, scanned_at: at, total_links: 10,
  broken_count: broken, dead_cta_count: dead, health_score: health,
});

const site = (scans: DashboardScan[], extra: Partial<DashboardSite> = {}): DashboardSite => ({
  id: "site", url: "https://example.test/", user_email: "o@x.test",
  last_scanned_at: scans.length ? scans[scans.length - 1].scanned_at : null,
  scans, ...extra,
});

// ── clean streak (§4, exact) ────────────────────────────────────────────────
test("streak: null with no scans; 0 when the latest scan has an issue", () => {
  assert.equal(cleanStreakDays(site([]), NOW), null);
  assert.equal(cleanStreakDays(site([scan("2026-08-01T00:00:00Z", 1)]), NOW), 0);
});

test("streak measures from the last scan that HAD an issue", () => {
  const s = site([
    scan("2026-08-01T00:00:00Z", 2),
    scan("2026-08-21T00:00:00Z", 1),
    scan("2026-08-29T00:00:00Z", 0),
  ]);
  assert.equal(cleanStreakDays(s, NOW), 10);
});

test("streak with a spotless history measures from the FIRST scan", () => {
  const s = site([scan("2026-08-25T00:00:00Z"), scan("2026-08-30T00:00:00Z")]);
  assert.equal(cleanStreakDays(s, NOW), 6);
});

test("dead CTAs count as issues; order of input scans is irrelevant", () => {
  const s = site([scan("2026-08-29T00:00:00Z", 0, 0), scan("2026-08-28T00:00:00Z", 0, 3)]);
  assert.equal(cleanStreakDays(s, NOW), 3);
});

// ── fixed this month (§4, exact) ────────────────────────────────────────────
test("fixed-this-month sums positive drops whose later scan is in the current month", () => {
  const s = site([
    scan("2026-07-30T00:00:00Z", 5, 1), // → drop in July: excluded
    scan("2026-07-31T00:00:00Z", 3, 1),
    scan("2026-08-10T00:00:00Z", 1, 1), // drop of 2 in August
    scan("2026-08-20T00:00:00Z", 4, 1), // increase: adds nothing
    scan("2026-08-30T00:00:00Z", 0, 0), // drop of 5
  ]);
  assert.equal(fixedThisMonth([s], NOW), 7);
});

test("fixed-this-month ignores sites with fewer than 2 scans", () => {
  assert.equal(fixedThisMonth([site([scan("2026-08-10T00:00:00Z", 3)])], NOW), 0);
});

// ── sorting (§2) ────────────────────────────────────────────────────────────
test("sort: issue sites first, then health ascending, never-scanned last", () => {
  const a = site([scan("2026-08-30T00:00:00Z", 0, 0, 95)], { id: "clean", url: "https://a.test" });
  const b = site([scan("2026-08-30T00:00:00Z", 2, 0, 60)], { id: "broken", url: "https://b.test" });
  const c = site([], { id: "never", url: "https://c.test" });
  const d = site([scan("2026-08-30T00:00:00Z", 0, 0, 70)], { id: "lower", url: "https://d.test" });
  assert.deepEqual(sortSites([a, c, d, b]).map((s) => s.id), ["broken", "lower", "clean", "never"]);
});

// ── chips, deltas, lines ────────────────────────────────────────────────────
test("status chip: broken beats dead CTA beats healthy; never-scanned is neutral", () => {
  assert.deepEqual(statusChip(site([scan("t", 1, 5)])), { tone: "error", label: "Broken links" });
  assert.deepEqual(statusChip(site([scan("t", 0, 2)])), { tone: "warning", label: "Needs attention" });
  assert.deepEqual(statusChip(site([scan("t")])), { tone: "success", label: "Healthy" });
  assert.deepEqual(statusChip(site([])), { tone: "neutral", label: "Not scanned yet" });
});

test("score delta: signed vs previous; first scan has no baseline (never zero)", () => {
  assert.deepEqual(scoreDelta(site([])), { kind: "pending" });
  assert.deepEqual(scoreDelta(site([scan("t", 0, 0, 90)])), { kind: "no_previous" });
  const s = site([scan("2026-08-01T00:00:00Z", 0, 0, 80), scan("2026-08-02T00:00:00Z", 0, 0, 90)]);
  assert.deepEqual(scoreDelta(s), { kind: "delta", value: 10 });
});

test("issue line pluralizes and distinguishes empty states", () => {
  assert.equal(issueLine(site([scan("t", 2, 1)])), "2 broken · 1 dead CTA");
  assert.equal(issueLine(site([scan("t")])), "No issues found");
  assert.equal(issueLine(site([])), "Run the first scan to see issues");
});

test("display name falls back to the domain, www stripped — never a placeholder", () => {
  assert.equal(displayName(site([], { name: "Acme" })), "Acme");
  assert.equal(displayName(site([], { url: "https://www.acme.test/x" })), "acme.test");
});

test("middle truncation keeps domain and final segment", () => {
  const t = middleTruncate("https://www.example.test/a/very/long/path/to/some/page.html", 40);
  assert.ok(t.includes("www.example.test"));
  assert.ok(t.endsWith("page.html"));
});

test("relative time buckets", () => {
  assert.equal(relativeTime(null, NOW), "Never scanned");
  assert.equal(relativeTime("2026-08-31T11:59:40Z", NOW), "just now");
  assert.equal(relativeTime("2026-08-31T11:15:00Z", NOW), "45m ago");
  assert.equal(relativeTime("2026-08-31T09:00:00Z", NOW), "3h ago");
  assert.equal(relativeTime("2026-08-28T09:00:00Z", NOW), "3d ago");
});

test("sparkline needs at least two scans and caps at six", () => {
  assert.deepEqual(sparkScores(site([scan("t", 0, 0, 90)])), []);
  const many = site(
    [1, 2, 3, 4, 5, 6, 7, 8].map((i) => scan(`2026-08-0${i}T00:00:00Z`.slice(0, 20), 0, 0, 90 + i)),
  );
  assert.deepEqual(sparkScores(many), [93, 94, 95, 96, 97, 98]);
});

test("band chips: sturdy green, normal neutral 'Steady', brittle amber, unknown null", () => {
  assert.deepEqual(bandChip("sturdy"), { label: "Sturdy", tone: "success" });
  assert.deepEqual(bandChip("normal"), { label: "Steady", tone: "neutral" });
  assert.deepEqual(bandChip("brittle"), { label: "Brittle", tone: "warning" });
  assert.equal(bandChip(undefined), null);
});
