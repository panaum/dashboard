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
