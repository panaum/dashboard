import { test } from "node:test";
import assert from "node:assert/strict";
import { plainAttribution, plainPlatform, type RawReport } from "./attribution-plain";

// The exact report the operator quoted as incomprehensible.
const REAL_FAIL: RawReport = {
  outcome: "ok",
  platform: "WordPress",
  platform_note: "no form plugin recognised — hidden field naming is unknown; also present: HubSpot",
  storage_hits: ["cookie[_gcl_aw]", "cookie[_fbc]", "localStorage[__storejs_convertbox_query_strings]"],
  cookie_attribution: ["HubSpot", "Google Ads", "Meta"],
  checks: [
    { name: "Platform", status: "INFO", detail: "WordPress (…)" },
    { name: "Forms found", status: "PASS", detail: "1 form(s), 2 inside an iframe, 2 input(s) outside any <form>" },
    { name: "Attribution fields", status: "FAIL", detail: "no attribution field exists on any form" },
    { name: "Tracking present", status: "PASS", detail: "GTM GTM-P593C44; GA4 G-HVNDX1EG1J; Meta pixel 110" },
  ],
};

test("no form fields, but a platform tracks by cookie: a caveat, not a failure", () => {
  // Verified on apexure.com: hubspotutk, _gcl_aw and _fbc are all set, so
  // HubSpot and Google Ads DO attribute the lead. Calling that broken cries
  // wolf, and the reader stops believing the tool.
  const v = plainAttribution(REAL_FAIL);
  assert.equal(v.tone, "warning", "must not be reported as a failure");
  assert.equal(v.headline, "The form itself records no campaign data");
  assert.match(v.meaning, /HubSpot, Google Ads and Meta track this visitor separately/);
  assert.match(v.meaning, /sent anywhere else/, "the real risk is named");
});

test("no fields AND no tracking anywhere is the genuine failure", () => {
  const v = plainAttribution({
    outcome: "ok",
    cookie_attribution: [],
    checks: [
      { name: "Forms found", status: "PASS", detail: "1 form(s)" },
      { name: "Attribution fields", status: "FAIL", detail: "no attribution field exists" },
    ],
  });
  assert.equal(v.tone, "error");
  assert.match(v.headline, /Nothing is recording where these leads come from/);
});

test("no jargon survives into the reader-facing copy", () => {
  const v = plainAttribution(REAL_FAIL);
  const prose = [v.headline, v.meaning, ...v.findings, ...v.fix].join(" ");
  for (const jargon of ["<form>", "iframe>", "input(s)", "cookie[", "localStorage[", "UTM ", "GTM-", "GA4"]) {
    assert.ok(!prose.includes(jargon), `"${jargon}" leaked into reader copy: ${prose}`);
  }
});

test("form counts are pluralised properly, not '1 form(s)'", () => {
  const v = plainAttribution(REAL_FAIL);
  assert.ok(v.findings.some((f) => f.includes("1 form")), v.findings.join(" | "));
  assert.ok(!v.findings.join(" ").includes("form(s)"));
});

test("the reader is not handed an essay", () => {
  const v = plainAttribution(REAL_FAIL);
  assert.ok(v.findings.length <= 2, `too many bullets: ${v.findings.length}`);
  assert.ok(v.fix.length <= 2, `too many steps: ${v.fix.length}`);
  assert.ok(v.meaning.length < 260, "the explanation must stay a couple of sentences");
});

test("trackers are named as products, never as variables", () => {
  const prose = plainAttribution(REAL_FAIL).findings.join(" ");
  assert.match(prose, /Google Tag Manager/);
  assert.match(prose, /Meta pixel/);
});

test("the fix names the actual fields, and says when it is even needed", () => {
  const v = plainAttribution(REAL_FAIL);
  assert.match(v.fix[0], /utm_source/);
  assert.match(v.fix[0], /Only needed if/, "don't demand work that isn't required");
});

test("fields present but empty is its own, nastier verdict", () => {
  const v = plainAttribution({
    outcome: "ok",
    checks: [
      { name: "Forms found", status: "PASS", detail: "2 form(s)" },
      { name: "Attribution fields", status: "PASS", detail: "7 of 7 present" },
      { name: "Attribution captured", status: "FAIL", detail: "field(s) exist but stayed EMPTY" },
    ],
  });
  assert.equal(v.tone, "error");
  assert.equal(v.headline, "The campaign details aren't reaching the form");
  assert.match(v.findings.join(" "), /right boxes, but they arrived empty/);
});

test("late population warns without calling it a failure", () => {
  const v = plainAttribution({
    outcome: "ok",
    checks: [
      { name: "Forms found", status: "PASS", detail: "1 form(s)" },
      { name: "Attribution fields", status: "PASS", detail: "7 of 7 present" },
      { name: "Attribution captured", status: "PASS", detail: "all hold the test values" },
      { name: "Population timing", status: "WARN", detail: "empty on load, filled by the 3s re-read" },
    ],
  });
  assert.equal(v.tone, "warning");
  assert.match(v.headline, /a little late/);
});

test("working pages say so plainly, and flag missing click ids for paid traffic", () => {
  const v = plainAttribution({
    outcome: "ok",
    checks: [
      { name: "Forms found", status: "PASS", detail: "1 form(s)" },
      { name: "Attribution fields", status: "WARN", detail: "5 of 7 present: … · missing: gclid, fbclid" },
      { name: "Attribution captured", status: "PASS", detail: "all hold the test values" },
      { name: "Population timing", status: "PASS", detail: "values present immediately" },
    ],
  });
  assert.equal(v.tone, "success");
  assert.match(v.headline, /will carry their source/);
  assert.match(v.findings.join(" "), /exact ad click/);
  assert.equal(v.fix.length, 0, "nothing to fix when it works");
});

test("a page with no form is neutral, not a failure", () => {
  const v = plainAttribution({ outcome: "no_form" });
  assert.equal(v.tone, "neutral");
  assert.match(v.headline, /No form on this page/);
});

test("a page that would not load says so without blaming the page's setup", () => {
  const v = plainAttribution({ outcome: "load_failed", error: "ERR_NAME_NOT_RESOLVED" });
  assert.equal(v.tone, "warning");
  assert.match(v.meaning, /wouldn't load/);
});

test("platform drops the parenthetical apparatus, and unknown shows nothing", () => {
  assert.equal(plainPlatform(REAL_FAIL), "WordPress");
  assert.equal(plainPlatform({ platform: "unknown" }), null);
  assert.equal(plainPlatform(null), null);
});
