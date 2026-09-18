import { test } from "node:test";
import assert from "node:assert/strict";
import { expiryWords, REPORT_LINK_TTL_S, signReportLink, verifyReportLink } from "./report-link";

const NOW = 1_800_000_000;
const SECRET = "a-real-secret-for-the-test";
const RUN = "cmu4b1jem0002kx04whbszxgx";

test("a signed link opens the run it names, for a fortnight", () => {
  const t = signReportLink(RUN, SECRET, NOW);
  const v = verifyReportLink(t, SECRET, NOW + 13 * 86400);
  assert.deepEqual(v, { ok: true, runId: RUN, exp: NOW + REPORT_LINK_TTL_S });
});

test("a day past the fortnight it opens nothing, and says why", () => {
  const t = signReportLink(RUN, SECRET, NOW);
  assert.deepEqual(verifyReportLink(t, SECRET, NOW + REPORT_LINK_TTL_S + 1), { ok: false, reason: "expired" });
});

test("a link cannot outlive the fortnight however long it asks for", () => {
  const t = signReportLink(RUN, SECRET, NOW, 365 * 86400);
  assert.equal(verifyReportLink(t, SECRET, NOW + REPORT_LINK_TTL_S + 60).ok, false);
});

test("a changed byte, a wrong secret, or a made-up token is refused — never a different run", () => {
  const t = signReportLink(RUN, SECRET, NOW);
  const [body, sig] = t.split(".");
  assert.equal(verifyReportLink(`${body}.${sig.slice(0, -1)}${sig.endsWith("0") ? "1" : "0"}`, SECRET, NOW).ok, false);
  assert.equal(verifyReportLink(t, "another-secret", NOW).ok, false);
  const other = Buffer.from(JSON.stringify({ run: "cmu000000000000000000000x", exp: NOW + 999, nonce: "x" })).toString("base64url");
  assert.deepEqual(verifyReportLink(`${other}.${sig}`, SECRET, NOW), { ok: false, reason: "bad signature" });
  for (const bad of ["", "nodot", "a.b", `${body}.zz`, "x".repeat(600)]) assert.equal(verifyReportLink(bad, SECRET, NOW).ok, false, bad.slice(0, 12));
});

test("no secret means no links — in either direction", () => {
  assert.throws(() => signReportLink(RUN, "", NOW), /secret/);
  assert.deepEqual(verifyReportLink(signReportLink(RUN, SECRET, NOW), "", NOW), { ok: false, reason: "no secret" });
});

test("only a run id is signed", () => {
  assert.throws(() => signReportLink("../etc", SECRET, NOW), /run id/);
  assert.throws(() => signReportLink("", SECRET, NOW), /run id/);
});

test("two links for the same run differ, so one cannot be guessed from another", () => {
  assert.notEqual(signReportLink(RUN, SECRET, NOW), signReportLink(RUN, SECRET, NOW));
});

test("the expiry reads as days", () => {
  assert.equal(expiryWords(NOW + 14 * 86400, NOW), "expires in 14 days");
  assert.equal(expiryWords(NOW + 86400, NOW), "expires tomorrow");
  assert.equal(expiryWords(NOW + 3600, NOW), "expires today");
});
