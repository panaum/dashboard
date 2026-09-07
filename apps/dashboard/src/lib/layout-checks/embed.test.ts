import { test } from "node:test";
import assert from "node:assert/strict";
import { embedDecision, qaUrl, QA_PARAMS } from "@/lib/layout-checks/embed";

const APP = "https://dashboard-nine-pi-19.vercel.app";
const PAGE = "https://breezioac.com/lp/";

test("a page with no framing headers can be shown", () => {
  assert.deepEqual(embedDecision({}, PAGE, APP), { embeddable: true, reason: "" });
  assert.equal(embedDecision({ xFrameOptions: null, contentSecurityPolicy: null }, PAGE, APP).embeddable, true);
});

test("X-Frame-Options is honoured the way a browser honours it", () => {
  assert.equal(embedDecision({ xFrameOptions: "DENY" }, PAGE, APP).embeddable, false);
  assert.match(embedDecision({ xFrameOptions: "DENY" }, PAGE, APP).reason, /DENY/);
  // Measured on elitepractice.clickfunnels.com, which refuses exactly this way.
  const same = embedDecision({ xFrameOptions: "SAMEORIGIN" }, PAGE, APP);
  assert.equal(same.embeddable, false);
  assert.match(same.reason, /SAMEORIGIN/);
  assert.equal(embedDecision({ xFrameOptions: "sameorigin" }, PAGE, PAGE).embeddable, true,
    "a page may frame itself");
});

test("CSP frame-ancestors wins where it is set", () => {
  assert.equal(embedDecision({ contentSecurityPolicy: "frame-ancestors 'none'" }, PAGE, APP).embeddable, false);
  assert.equal(embedDecision({ contentSecurityPolicy: "default-src 'self'; frame-ancestors 'self'" }, PAGE, APP).embeddable, false);
  assert.equal(embedDecision({ contentSecurityPolicy: "frame-ancestors *" }, PAGE, APP).embeddable, true);
  assert.equal(embedDecision({ contentSecurityPolicy: "frame-ancestors https://dashboard-nine-pi-19.vercel.app" }, PAGE, APP).embeddable, true);
  assert.equal(embedDecision({ contentSecurityPolicy: "frame-ancestors *.vercel.app" }, PAGE, APP).embeddable, true);
  assert.equal(embedDecision({ contentSecurityPolicy: "frame-ancestors https://example.com" }, PAGE, APP).embeddable, false);
});

test("a permissive CSP does not rescue a page that also sends DENY", () => {
  const v = embedDecision({ contentSecurityPolicy: "frame-ancestors *", xFrameOptions: "DENY" }, PAGE, APP);
  assert.equal(v.embeddable, false, "the stricter header still applies");
});

test("the live URL is tagged as QA traffic, like the sweep", () => {
  const u = new URL(qaUrl(PAGE));
  for (const [k, v] of Object.entries(QA_PARAMS)) assert.equal(u.searchParams.get(k), v, k);
  assert.equal(u.origin + u.pathname, "https://breezioac.com/lp/");
});

test("tagging keeps the page's own query and never loses the path", () => {
  const u = new URL(qaUrl("https://x.com/lp/?ref=abc&utm_source=real"));
  assert.equal(u.searchParams.get("ref"), "abc", "the page's own parameters survive");
  assert.equal(u.searchParams.get("utm_source"), "qa", "ours wins, so the visit is identifiable");
  assert.equal(u.pathname, "/lp/");
});

test("a URL that cannot be parsed is returned untouched rather than mangled", () => {
  assert.equal(qaUrl("not a url"), "not a url");
});
