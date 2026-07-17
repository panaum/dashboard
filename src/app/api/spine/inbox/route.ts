import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { verify, EVENT_TYPES, SPINE_SIG_HEADER, SPINE_SENT_AT_HEADER } from "@/lib/spine-contract";

// Dashboard spine INBOX (Phase 5) — the mirror direction: LinkSpy → Dashboard.
// Receives checklist.candidate_created, HMAC-verified (contract v2, ±5-min skew),
// idempotent by the LinkSpy candidate id. Writes a ChecklistCandidate row for the
// review queue. Never touches any existing QA row.
export async function POST(req: NextRequest) {
  const secret = process.env.SPINE_SECRET || "";
  if (!secret) return NextResponse.json({ error: "spine not configured" }, { status: 503 });

  const raw = await req.text();
  const v = verify(raw, secret, req.headers.get(SPINE_SIG_HEADER), req.headers.get(SPINE_SENT_AT_HEADER),
                   Math.floor(Date.now() / 1000));
  if (!v.ok) return NextResponse.json({ error: v.reason }, { status: 401 });

  let env: { type?: string; payload?: Record<string, unknown> };
  try { env = JSON.parse(raw); } catch { return NextResponse.json({ error: "bad json" }, { status: 400 }); }
  const type = env.type;
  const payload = (env.payload ?? {}) as Record<string, unknown>;

  if (type === EVENT_TYPES.CANDIDATE_CREATED) {
    const ref = String(payload.candidate_id ?? "");
    if (!ref) return NextResponse.json({ error: "missing candidate_id" }, { status: 400 });
    // Idempotent by the LinkSpy candidate ref.
    const existing = await db.checklistCandidate.findUnique({ where: { linkspyCandidateRef: ref } });
    if (existing) return NextResponse.json({ duplicate: true });
    await db.checklistCandidate.create({
      data: {
        linkspyCandidateRef: ref,
        incidentClass: String(payload.incident_class ?? "unknown"),
        proposedWording: String(payload.proposed_wording ?? ""),
        evidence: payload as Prisma.InputJsonValue, // full payload (proposed_check_key, …)
        machineVerifiable: Boolean(payload.machine_verifiable),
      },
    });
    return NextResponse.json({ ok: true, created: true });
  }

  // No other inbound event type is expected today; accept + ignore (forward-compat).
  return NextResponse.json({ ok: true, ignored: type });
}
