import { test } from "node:test";
import assert from "node:assert/strict";
import {
  filterLinks, groupByZone, zoneLabel, latencyTone, bucketBadge, scoreTone,
  type FullLink,
} from "./scanner-view";

const link = (bucket: string, zone: string, anchor = "Link", extra: Partial<FullLink> = {}): FullLink => ({
  url: `https://x.test/${anchor}`, anchor_text: anchor, bucket, zone, ...extra,
});

test("filter: working keeps only ok; broken keeps broken + dead_cta", () => {
  const links = [link("ok", "nav"), link("broken", "cta"), link("dead_cta", "footer"), link("unverifiable", "body")];
  assert.equal(filterLinks(links, "working", "").length, 1);
  assert.equal(filterLinks(links, "broken", "").length, 2);
  assert.equal(filterLinks(links, "unverifiable", "").length, 1);
  assert.equal(filterLinks(links, "all", "").length, 4);
});

test("filter: query matches url or anchor, case-insensitive", () => {
  const links = [link("ok", "nav", "Contact us"), link("ok", "cta", "Buy now")];
  assert.equal(filterLinks(links, "all", "contact").length, 1);
  assert.equal(filterLinks(links, "all", "BUY").length, 1);
});

test("group by zone: spec order, unknown zones last, broken floats up within a group", () => {
  const links = [
    link("ok", "footer"), link("broken", "cta"), link("ok", "nav"),
    link("ok", "cta"), link("broken", "mystery"),
  ];
  const groups = groupByZone(links);
  assert.deepEqual(groups.map((g) => g.zone), ["nav", "cta", "footer", "mystery"]);
  const cta = groups.find((g) => g.zone === "cta")!;
  assert.equal(cta.links[0].bucket, "broken", "broken sorts first within the zone");
});

test("zone labels are human", () => {
  assert.equal(zoneLabel("nav"), "Navigation");
  assert.equal(zoneLabel("body_text"), "Body text");
  assert.equal(zoneLabel("weird"), "Weird");
});

test("latency tint thresholds (spec §5)", () => {
  assert.equal(latencyTone(120), "success");
  assert.equal(latencyTone(500), "warning");
  assert.equal(latencyTone(1500), "error");
  assert.equal(latencyTone(null), "neutral");
});

test("bucket badge: unverifiable is neutral, never red (honesty rule)", () => {
  assert.equal(bucketBadge("broken").tone, "error");
  assert.equal(bucketBadge("dead_cta").tone, "warning");
  assert.equal(bucketBadge("unverifiable").tone, "neutral");
  assert.equal(bucketBadge("ok").tone, "success");
});

test("score ring tone by threshold", () => {
  assert.equal(scoreTone(95), "success");
  assert.equal(scoreTone(80), "warning");
  assert.equal(scoreTone(50), "error");
  assert.equal(scoreTone(undefined), "neutral");
});

test("integration tone: down red, healthy green, unknown NEVER green", async () => {
  const { integrationTone } = await import("./scanner-view");
  assert.equal(integrationTone("down"), "error");
  assert.equal(integrationTone("healthy"), "success");
  assert.equal(integrationTone("weird"), "neutral");
  assert.equal(integrationTone(undefined), "neutral");
  assert.notEqual(integrationTone("unresponsive"), "success");
});

test("zone summary counts buckets; unverifiable never forces a zone open", async () => {
  const { zoneSummary, zoneStatusLine } = await import("./scanner-view");
  const clean = zoneSummary([link("ok", "nav"), link("ok", "nav")]);
  assert.equal(clean.allClear, true);
  assert.equal(zoneStatusLine(clean), "All working");

  const unver = zoneSummary([link("ok", "nav"), link("unverifiable", "nav")]);
  assert.equal(unver.allClear, true, "unverifiable is not a failure");
  assert.equal(zoneStatusLine(unver), "1 unverifiable");

  const bad = zoneSummary([link("broken", "cta"), link("dead_cta", "cta"), link("ok", "cta")]);
  assert.equal(bad.allClear, false);
  assert.equal(bad.broken, 1);
  assert.equal(zoneStatusLine(bad), "1 broken · 1 dead CTA");
});

test("integrations group by category, dedupe hosts with counts, worst health wins", async () => {
  const { groupIntegrations } = await import("./scanner-view");
  const groups = groupIntegrations([
    { host: "gtm.com", category: "Tag Management", health: "healthy", detected_id: "GTM-1" },
    { host: "gtm.com", category: "Tag Management", health: "healthy" },
    { host: "gtm.com", category: "Tag Management", health: "down" },
    { host: "fb.net", category: "Advertising/Pixels", health: "healthy" },
    { host: "cdn.test", category: "Fonts/CDN", health: "healthy" },
    { host: "cdn.test", category: "Fonts/CDN", health: "healthy" },
  ]);
  const tag = groups.find((g) => g.category === "Tag Management")!;
  assert.equal(tag.hosts.length, 1, "six rows for one host collapse to one");
  assert.equal(tag.hosts[0].count, 3);
  assert.deepEqual(tag.hosts[0].ids, ["GTM-1"]);
  assert.equal(tag.hosts[0].tone, "error", "one down resource makes the host worth looking at");
  assert.equal(groups[0].category, "Tag Management", "categories with problems sort first");
});

test("integrations grouping handles empty and missing categories", async () => {
  const { groupIntegrations } = await import("./scanner-view");
  assert.deepEqual(groupIntegrations(undefined), []);
  const g = groupIntegrations([{ host: "x.test", health: "healthy" }]);
  assert.equal(g[0].category, "Other");
});
