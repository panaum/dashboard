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
