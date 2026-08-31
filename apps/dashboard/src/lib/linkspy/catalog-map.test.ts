import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildAnnotations,
  serveFromCache,
  serveAfterFetch,
  type LinkSpyCheck,
  type LinkSpyStatusPayload,
} from "./catalog-map";

function check(key: string, verdict: LinkSpyCheck["verdict"], detail = "d", extra: Partial<LinkSpyCheck> = {}): LinkSpyCheck {
  return { key, verdict, detail_plain: detail, last_checked: "2026-07-13T09:00:00Z", incident_ref: null, ...extra };
}
function payload(checks: LinkSpyCheck[], mapped = true): LinkSpyStatusPayload {
  return { mapped, as_of: "2026-07-13T09:00:00Z", checks };
}

// ── buildAnnotations: mapping ──
test("maps confident item keys onto their checklist item names", () => {
  const a = buildAnnotations(payload([
    check("ssl_valid", "holding"),
    check("page_load_time", "holding"),
    check("forms_submit", "holding"),
    check("ga4_installed", "holding"),
    check("pixel_present", "holding"),
    check("broken_links", "holding"),
  ]))!;
  assert.ok(a.byItemName["SSL Certificate showing up correctly"]);
  assert.ok(a.byItemName["GTMetrix Page Load Time"]);
  assert.ok(a.byItemName["Form Submits Correctly"]);
  assert.ok(a.byItemName["Google Analytics Installed"]);
  assert.ok(a.byItemName["Facebook Pixel Installed"]);
  assert.ok(a.byItemName["All CTA buttons work"]);
  assert.equal(a.watchedItemCount, 6);
});

test("ssl_valid + ssl_expiry collapse onto ONE item; worst verdict wins", () => {
  const a = buildAnnotations(payload([
    check("ssl_valid", "holding", "SSL certificate is valid."),
    check("ssl_expiry", "failing", "SSL certificate expires in 4 days."),
  ]))!;
  const ssl = a.byItemName["SSL Certificate showing up correctly"];
  assert.equal(Object.keys(a.byItemName).length, 1);
  assert.equal(ssl.verdict, "failing");
  assert.match(ssl.detail, /expires in 4 days/);
});

test("uptime + domain go to page-level, not to an item", () => {
  const a = buildAnnotations(payload([
    check("uptime", "holding", "Reachable · 99.9% uptime"),
    check("domain_expiry", "holding", "Domain registered · 200 days remaining."),
  ]))!;
  assert.equal(Object.keys(a.byItemName).length, 0);
  assert.equal(a.pageLevel.length, 2);
  assert.deepEqual(a.pageLevel.map((s) => s.key).sort(), ["domain_expiry", "uptime"]);
});

test("unmapped keys (gtm_setup) surface nowhere", () => {
  const a = buildAnnotations(payload([check("gtm_setup", "failing"), check("ga4_installed", "holding")]))!;
  assert.equal(a.byItemName["Google Analytics Installed"].verdict, "holding");
  assert.equal(Object.keys(a.byItemName).length, 1); // gtm dropped
});

test("summary counts only what THIS app surfaces", () => {
  const a = buildAnnotations(payload([
    check("ga4_installed", "holding"),
    check("forms_submit", "failing"),
    check("uptime", "holding"),
    check("gtm_setup", "failing"), // unmapped → excluded from counts
  ]))!;
  assert.deepEqual(a.summary, { total: 3, holding: 2, failing: 1, couldnt_verify: 0 });
});

test("couldnt_verify is preserved as its own class (never failing)", () => {
  const a = buildAnnotations(payload([check("pixel_present", "couldnt_verify")]))!;
  assert.equal(a.byItemName["Facebook Pixel Installed"].verdict, "couldnt_verify");
  assert.equal(a.summary.failing, 0);
});

test("null / unmapped / malformed payloads yield null (nothing to render)", () => {
  assert.equal(buildAnnotations(null), null);
  assert.equal(buildAnnotations(undefined), null);
  assert.equal(buildAnnotations(payload([], false)), null);
  assert.equal(buildAnnotations({ mapped: true } as LinkSpyStatusPayload), null);
});

// ── cache / staleness policy ──
const P = payload([check("ga4_installed", "holding")]);

test("fresh cache is served without a fetch (no stale flag)", () => {
  const now = 1_000_000;
  const cached = { payload: P, fetchedAt: new Date(now - 5 * 60_000) }; // 5 min old
  const r = serveFromCache(cached, now, 15 * 60_000);
  assert.equal(r.hit, true);
  assert.equal(r.status?.stale, false);
});

test("expired cache is a miss → caller must fetch", () => {
  const now = 1_000_000;
  const cached = { payload: P, fetchedAt: new Date(now - 20 * 60_000) }; // 20 min old
  assert.equal(serveFromCache(cached, now, 15 * 60_000).hit, false);
});

test("unreachable LinkSpy → serve last-known-good marked stale (never an error)", () => {
  const cached = { payload: P, fetchedAt: new Date("2026-07-13T08:00:00Z") };
  const served = serveAfterFetch(cached, null, new Date()); // fresh=null = unreachable
  assert.ok(served);
  assert.equal(served!.stale, true);
  assert.equal(served!.asOf, "2026-07-13T09:00:00Z"); // as_of from the cached payload
});

test("fresh fetch wins over cache and is not stale", () => {
  const cached = { payload: P, fetchedAt: new Date("2026-07-13T08:00:00Z") };
  const fresh = payload([check("ga4_installed", "failing")]);
  const served = serveAfterFetch(cached, fresh, new Date())!;
  assert.equal(served.stale, false);
  assert.equal(served.payload.checks![0].verdict, "failing");
});

test("no cache and unreachable → null (module shows its quiet state)", () => {
  assert.equal(serveAfterFetch(null, null, new Date()), null);
});
