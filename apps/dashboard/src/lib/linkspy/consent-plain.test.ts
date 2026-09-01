import { test } from "node:test";
import assert from "node:assert/strict";
import { friendlyName, plainConsent, regimeSentence, GROUP_COPY } from "./consent-plain";
import type { ConsentSession } from "./intent-consent-view";

test("friendly names turn hostnames into companies people recognise", () => {
  assert.equal(friendlyName("connect.facebook.net"), "Facebook");
  assert.equal(friendlyName("www.google-analytics.com"), "Google Analytics");
  assert.equal(friendlyName("googleads.g.doubleclick.net"), "Google Ads");
  assert.equal(friendlyName("js.hs-scripts.com"), "HubSpot");
  assert.equal(friendlyName("fonts.googleapis.com"), "Google Fonts");
  assert.equal(friendlyName("cdn.jsdelivr.net"), "Code library (CDN)");
  assert.equal(friendlyName("polyfill-fastly.io"), "Browser polyfill service");
});

test("unknown hosts get a tidy fallback, never a raw cdn string", () => {
  assert.equal(friendlyName("cdn.somevendor.com"), "Somevendor");
  assert.equal(friendlyName("scripts.lead-genapp.io"), "Lead genapp");
  assert.equal(friendlyName(""), "Unknown service");
  assert.equal(friendlyName(null), "Unknown service");
});

const session = (over: Partial<ConsentSession> = {}): ConsentSession => ({
  id: Math.random().toString(36), page_url: "https://x.test/page",
  regime: "US", created_at: "2026-07-14T00:00:00Z",
  requests: [
    { host: "connect.facebook.net", class: "advertising" },
    { host: "fonts.googleapis.com", class: "essential" },
  ],
  ...over,
});

test("repeated sessions of one page collapse into a single entry", () => {
  const out = plainConsent([session(), session(), session({ regime: "UK" })]);
  assert.equal(out.length, 1, "three runs of the same page are one card");
  assert.equal(out[0].checks, 3);
  assert.deepEqual(out[0].regimes, ["UK", "US"]);
});

test("companies are deduped and grouped by what they do, worst first", () => {
  const out = plainConsent([
    session(),
    session({ requests: [
      { host: "connect.facebook.net", class: "advertising" },
      { host: "www.google-analytics.com", class: "analytics" },
    ] }),
  ]);
  const g = out[0].groups;
  assert.equal(g[0].key, "advertising", "advertising sorts first");
  assert.deepEqual(g[0].companies, ["Facebook"], "seen twice, listed once");
  assert.equal(out[0].totalCompanies, 3, "Facebook + Google Analytics + Google Fonts");
  assert.equal(g[g.length - 1].key, "essential", "essential sorts last");
});

test("a detected consent banner is reported from either cmp shape", () => {
  assert.equal(plainConsent([session({ cmp: {} })])[0].bannerSeen, false);
  assert.equal(plainConsent([session({ cmp: { name: "OneTrust" } })])[0].bannerSeen, true);
  assert.equal(plainConsent([session({ cmp: "generic" })])[0].bannerSeen, true);
});

test("every group has reader-facing copy", () => {
  for (const k of ["advertising", "analytics", "essential", "other"] as const) {
    assert.ok(GROUP_COPY[k].title && GROUP_COPY[k].blurb);
  }
});

test("regime sentence reads as English", () => {
  assert.equal(regimeSentence(["US"]), "Checked under US privacy rules.");
  assert.equal(regimeSentence(["UK", "US"]), "Checked under UK/EU privacy rules and US privacy rules.");
  assert.equal(regimeSentence([]), "");
});

test("collector's real class vocabulary maps correctly (advertising-adtech, functional)", () => {
  const out = plainConsent([session({ requests: [
    { host: "googleads.g.doubleclick.net", class: "advertising-adtech" },
    { host: "js.hsforms.net", class: "functional" },
    { host: "www.googletagmanager.com", class: "analytics" },
    { host: "polyfill-fastly.io", class: "essential" },
    { host: "api.hubapi.com", class: "unknown" },
  ] })]);
  const keys = out[0].groups.map((g) => g.key);
  assert.deepEqual(keys, ["advertising", "analytics", "functional", "other", "essential"]);
  const adv = out[0].groups.find((g) => g.key === "advertising")!;
  assert.deepEqual(adv.companies, ["Google Ads"], "advertising-adtech must NOT fall into Other");
  const fn = out[0].groups.find((g) => g.key === "functional")!;
  assert.deepEqual(fn.companies, ["HubSpot"]);
});

test("fallback names the registrable domain, not a middle label", () => {
  assert.equal(friendlyName("scripts.forms.cliqforms.com"), "Cliqforms");
  assert.equal(friendlyName("www.google.com.sg"), "Google");
  assert.equal(friendlyName("echo-six-kohl.vercel.app"), "Vercel");
});
