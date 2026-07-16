import { test } from "node:test";
import assert from "node:assert/strict";
import { signHandoff, verifyHandoff, handoffUrl, HANDOFF_CHECKSUM, HANDOFF_MAX_TTL_S } from "./handoff-contract";

const SECRET = "spine-secret-fixture";
const NOW = 1_000_000;

test("checksum is the agreed handoff-contract version", () => {
  assert.equal(HANDOFF_CHECKSUM, "90b6a00da54c193c9142e31d8d8529a718dbb7933825b18f27162418a9ac7374");
});

test("sign → verify round-trips a target path", () => {
  const t = signHandoff("/dashboard/clients/c1/p1/x", SECRET, NOW);
  const v = verifyHandoff(t, SECRET, NOW + 10);
  assert.ok(v.ok && v.targetPath === "/dashboard/clients/c1/p1/x");
});

test("ttl is capped at 5 minutes", () => {
  const t = signHandoff("/x", SECRET, NOW, 99999);
  assert.equal(verifyHandoff(t, SECRET, NOW + HANDOFF_MAX_TTL_S - 1).ok, true);
  assert.equal(verifyHandoff(t, SECRET, NOW + HANDOFF_MAX_TTL_S + 5).ok, false);
});

test("expired token is rejected", () => {
  const t = signHandoff("/x", SECRET, NOW - 400); // exp = NOW-100
  const v = verifyHandoff(t, SECRET, NOW);
  assert.equal(v.ok, false);
  if (!v.ok) assert.match(v.reason, /expired/);
});

test("wrong secret is rejected", () => {
  const t = signHandoff("/x", SECRET, NOW);
  assert.equal(verifyHandoff(t, "other-secret", NOW).ok, false);
});

test("tampered body is rejected", () => {
  const t = signHandoff("/x", SECRET, NOW);
  const dot = t.indexOf(".");
  const tampered = (t[0] === "A" ? "B" : "A") + t.slice(1, dot) + t.slice(dot);
  assert.equal(verifyHandoff(tampered, SECRET, NOW).ok, false);
});

test("tampered signature is rejected", () => {
  const t = signHandoff("/x", SECRET, NOW);
  const tampered = t.slice(0, -1) + (t.slice(-1) === "a" ? "b" : "a");
  assert.equal(verifyHandoff(tampered, SECRET, NOW).ok, false);
});

test("malformed token is rejected", () => {
  assert.equal(verifyHandoff("", SECRET, NOW).ok, false);
  assert.equal(verifyHandoff("nodot", SECRET, NOW).ok, false);
});

test("handoffUrl points at /handoff?token= on the given base", () => {
  const u = handoffUrl("https://linkspy.example.com/", "/dashboard/x", SECRET, NOW);
  assert.match(u, /^https:\/\/linkspy\.example\.com\/handoff\?token=/);
});
