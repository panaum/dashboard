// ═══════════════════════════════════════════════════════════════════════════
// SPINE CONTRACT v1 — shared, duplicated verbatim in both repos.
//   LinkSpy:   backend/spine_contract.py
//   Dashboard: src/lib/spine-contract.ts   (this file)
// CONTRACT_CHECKSUM (sha256 of the canonical spec): must match in both files.
// ═══════════════════════════════════════════════════════════════════════════
import { createHmac, timingSafeEqual } from "node:crypto";

// v2: added checklist.candidate_created + checklist.item_promoted (Phase 5 flywheel).
export const CONTRACT_CHECKSUM =
  "36924adb1f215608a293759e8bbb78f88b37d17a4ac408ec5ef8b11d5fbab66b";

export const SPINE_SCHEMA_VERSION = 1 as const;
export const SPINE_SIG_HEADER = "x-spine-signature";
export const SPINE_SENT_AT_HEADER = "x-spine-sent-at";
export const SKEW_MAX_SECONDS = 300;

export const EVENT_TYPES = {
  READY_FOR_QA: "deliverable.ready_for_qa",
  QA_COMPLETED: "qa.completed",
  HEARTBEAT: "heartbeat",
  CANDIDATE_CREATED: "checklist.candidate_created", // LinkSpy → Dashboard (flywheel)
  ITEM_PROMOTED: "checklist.item_promoted", //        Dashboard → LinkSpy (flywheel)
} as const;
export type EventType = (typeof EVENT_TYPES)[keyof typeof EVENT_TYPES];

export type SpineEnvelope = {
  id: string; // uuid — the idempotency key on the inbox side
  type: EventType;
  schema_version: 1;
  occurred_at: string; // ISO-8601
  producer: string;
  registry_deliverable_id?: string | null;
  registry_site_id?: string | null;
  payload: Record<string, unknown>;
};

// HMAC-SHA256(secret, rawBody) → lowercase hex. Signs/verifies the EXACT bytes
// on the wire (raw body), so re-serialization can never break the signature.
export function sign(rawBody: string, secret: string): string {
  return createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
}

// Pure trigger predicates (unit-tested; the status actions call these so the
// tested logic IS the used logic). Emit only on the exact mapped transition for
// a registry-linked deliverable.
export function shouldEmitReady(
  enabled: boolean, newStatus: string, beforeStatus: string | null | undefined, hasDeliverable: boolean,
): boolean {
  return enabled && newStatus === "IN_QA" && beforeStatus !== "IN_QA" && hasDeliverable;
}
export function shouldEmitCompleted(
  enabled: boolean, newCertStatus: string, beforeCertStatus: string | null | undefined, hasDeliverable: boolean,
): boolean {
  return enabled && (newCertStatus === "PASS" || newCertStatus === "FAIL") &&
    beforeCertStatus === "IN_PROGRESS" && hasDeliverable;
}

export function verify(
  rawBody: string,
  secret: string,
  signature: string | null | undefined,
  sentAt: string | null | undefined,
  nowSeconds: number,
): { ok: true } | { ok: false; reason: string } {
  if (!signature) return { ok: false, reason: "missing signature" };
  const sent = Number(sentAt);
  if (!Number.isFinite(sent)) return { ok: false, reason: "missing/invalid sent-at" };
  if (Math.abs(nowSeconds - sent) > SKEW_MAX_SECONDS) return { ok: false, reason: "timestamp skew" };
  const expected = sign(rawBody, secret);
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(signature, "hex");
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false, reason: "bad signature" };
  return { ok: true };
}
