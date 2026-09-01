import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildIntentMapView,
  verdictTone,
  buildConsentView,
  cappedRequests,
  cmpLabel,
  requestClassTone,
  CONSENT_REQUEST_CAP,
  type Promise_,
  type ConsentSession,
} from "./intent-consent-view";

const promise = (verdict: Promise_["verdict"], label = "Book"): Promise_ => ({
  type: "book", label, anchor: label, url: "https://x.test", verdict,
});

test("intent map: unavailable / no-scan / no-promises are distinct states", () => {
  assert.deepEqual(buildIntentMapView(null), { state: "unavailable" });
  assert.equal(buildIntentMapView({ no_scan: true }).state, "no_scan");
  const none = buildIntentMapView({ counts: { conversion_total: 0 }, verdict: "none" });
  assert.equal(none.state, "no_promises");
});

test("intent map sorts broken → unverified → honored", () => {
  const v = buildIntentMapView({
    counts: { conversion_total: 3, honored: 1, broken: 1, unverified: 1 },
    promises: [promise("honored"), promise("unverified"), promise("broken")],
  });
  assert.equal(v.state, "map");
  if (v.state === "map") assert.deepEqual(v.promises.map((p) => p.verdict), ["broken", "unverified", "honored"]);
});

test("counts default to zero rather than undefined", () => {
  const v = buildIntentMapView({ counts: { conversion_total: 2, broken: 1 }, promises: [promise("broken")] });
  if (v.state === "map") {
    assert.equal(v.counts.honored, 0);
    assert.equal(v.counts.unverified, 0);
  }
});

test("verdict tone: broken red, honored green, unverified NEVER red (honesty rule)", () => {
  assert.equal(verdictTone("broken"), "error");
  assert.equal(verdictTone("honored"), "success");
  assert.equal(verdictTone("unverified"), "neutral");
});

// ── consent ──────────────────────────────────────────────────────────────────

const session = (n: number): ConsentSession => ({
  id: `s${n}`, page_url: "https://x.test",
  requests: Array.from({ length: n }, (_, i) => ({ host: `h${i}.test`, class: "analytics", ms_after_load: i * 10 })),
});

test("consent: unavailable vs empty (with scope) vs sessions", () => {
  assert.deepEqual(buildConsentView(null), { state: "unavailable" });
  const empty = buildConsentView({ scope_statement: "SCOPE", sessions: [] });
  assert.deepEqual(empty, { state: "empty", scopeStatement: "SCOPE" });
  const s = buildConsentView({ scope_statement: "SCOPE", sessions: [session(2)] });
  assert.equal(s.state, "sessions");
});

test("requests are capped at 8 and the overflow is reported", () => {
  const { shown, hidden } = cappedRequests(session(11));
  assert.equal(shown.length, CONSENT_REQUEST_CAP);
  assert.equal(hidden, 3);
  const few = cappedRequests(session(3));
  assert.equal(few.hidden, 0);
});

test("cmpLabel never returns a raw object — the backend sends cmp as {} (crashed the page)", () => {
  assert.equal(cmpLabel({}), null, "empty object → null, never rendered as a React child");
  assert.equal(cmpLabel({ name: "OneTrust" }), "OneTrust");
  assert.equal(cmpLabel({ provider: "Cookiebot" }), "Cookiebot");
  assert.equal(cmpLabel("Osano"), "Osano");
  assert.equal(cmpLabel(null), null);
  assert.equal(cmpLabel(undefined), null);
  assert.equal(cmpLabel({ detail: "x" }), null, "an object with no name is null, not '[object Object]'");
});

test("request class tone: advertising red, analytics amber, essential neutral", () => {
  assert.equal(requestClassTone("advertising"), "error");
  assert.equal(requestClassTone("analytics"), "warning");
  assert.equal(requestClassTone("essential"), "neutral");
  assert.equal(requestClassTone(null), "neutral");
});
