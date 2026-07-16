import { test } from "node:test";
import assert from "node:assert/strict";
import {
  sign, verify, shouldEmitReady, shouldEmitCompleted,
  SKEW_MAX_SECONDS, CONTRACT_CHECKSUM,
} from "./spine-contract";

const SECRET = "fixture-secret";
const BODY = '{"id":"e1","type":"heartbeat","payload":{}}';

test("checksum is the agreed contract version", () => {
  assert.equal(CONTRACT_CHECKSUM, "175499b1741e8eca5f744350b87327e4d116d77a45fc137a5facb0dab7c57c9d");
});

// ── HMAC ──
test("sign is deterministic hex sha256 hmac", () => {
  const s = sign(BODY, SECRET);
  assert.match(s, /^[0-9a-f]{64}$/);
  assert.equal(s, sign(BODY, SECRET));
});

test("verify accepts a good signature within skew", () => {
  const now = 1_000_000;
  const r = verify(BODY, SECRET, sign(BODY, SECRET), String(now), now);
  assert.equal(r.ok, true);
});

test("verify rejects a bad signature", () => {
  const now = 1_000_000;
  const r = verify(BODY, SECRET, sign(BODY, "wrong-secret"), String(now), now);
  assert.equal(r.ok, false);
});

test("verify rejects a tampered body", () => {
  const now = 1_000_000;
  const sig = sign(BODY, SECRET);
  const r = verify(BODY + " ", SECRET, sig, String(now), now);
  assert.equal(r.ok, false);
});

test("verify rejects timestamp skew beyond the window", () => {
  const now = 1_000_000;
  const sentAt = now - (SKEW_MAX_SECONDS + 5);
  const r = verify(BODY, SECRET, sign(BODY, SECRET), String(sentAt), now);
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.reason, /skew/);
});

test("verify rejects missing signature / sent-at", () => {
  const now = 1_000_000;
  assert.equal(verify(BODY, SECRET, null, String(now), now).ok, false);
  assert.equal(verify(BODY, SECRET, sign(BODY, SECRET), null, now).ok, false);
});

// ── trigger predicates (emit only on the mapped transition) ──
test("ready emits ONLY into IN_QA, registry-linked, when enabled", () => {
  assert.equal(shouldEmitReady(true, "IN_QA", "IN_PROGRESS", true), true);
  assert.equal(shouldEmitReady(false, "IN_QA", "IN_PROGRESS", true), false); // SPINE_EMIT off
  assert.equal(shouldEmitReady(true, "IN_QA", "IN_QA", true), false);        // no-op transition
  assert.equal(shouldEmitReady(true, "LIVE", "IN_QA", true), false);         // not into IN_QA
  assert.equal(shouldEmitReady(true, "IN_QA", "IN_PROGRESS", false), false); // not registry-linked
});

test("completed emits ONLY on cert IN_PROGRESS -> PASS/FAIL, registry-linked", () => {
  assert.equal(shouldEmitCompleted(true, "PASS", "IN_PROGRESS", true), true);
  assert.equal(shouldEmitCompleted(true, "FAIL", "IN_PROGRESS", true), true);
  assert.equal(shouldEmitCompleted(false, "PASS", "IN_PROGRESS", true), false); // off
  assert.equal(shouldEmitCompleted(true, "IN_PROGRESS", "IN_PROGRESS", true), false); // not a finalize
  assert.equal(shouldEmitCompleted(true, "PASS", "PASS", true), false);        // already finalized
  assert.equal(shouldEmitCompleted(true, "PASS", "IN_PROGRESS", false), false); // unmapped
});
