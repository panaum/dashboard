import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { sign, SPINE_SIG_HEADER, SPINE_SENT_AT_HEADER, SPINE_SCHEMA_VERSION, EVENT_TYPES, type SpineEnvelope } from "@/lib/spine-contract";

// Cron-driven drain: POST undelivered outbox rows to LinkSpy's inbox with HMAC.
// Protected by CRON_SECRET (Vercel sends `Authorization: Bearer <CRON_SECRET>`).
// Staleness over errors: a non-2xx just increments attempts + records lastError;
// the row retries on the next drain (no dead state in v1).
const BATCH = 20;
const HEARTBEAT_GAP_MS = 55 * 60 * 1000;

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true; // not yet configured → allow (pre-activation)
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(req: NextRequest) {
  return run(req);
}
export async function POST(req: NextRequest) {
  return run(req);
}

async function run(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const base = (process.env.LINKSPY_API_URL || "").replace(/\/$/, "");
  const secret = process.env.SPINE_SECRET || "";
  if (!base || !secret) return NextResponse.json({ skipped: "spine not configured" });

  // Heartbeat: ensure ~1/hour even when idle.
  const lastHeartbeat = await db.spineOutbox.findFirst({
    where: { type: EVENT_TYPES.HEARTBEAT },
    orderBy: { occurredAt: "desc" },
    select: { occurredAt: true },
  });
  if (!lastHeartbeat || Date.now() - lastHeartbeat.occurredAt.getTime() > HEARTBEAT_GAP_MS) {
    await db.spineOutbox.create({ data: { type: EVENT_TYPES.HEARTBEAT, payload: {} } });
  }

  const rows = await db.spineOutbox.findMany({
    where: { deliveredAt: null },
    orderBy: { occurredAt: "asc" },
    take: BATCH,
  });

  let delivered = 0, failed = 0;
  for (const row of rows) {
    const envelope: SpineEnvelope = {
      id: row.id,
      type: row.type as SpineEnvelope["type"],
      schema_version: SPINE_SCHEMA_VERSION,
      occurred_at: row.occurredAt.toISOString(),
      producer: "deliverables-dashboard",
      registry_deliverable_id: row.registryDeliverableId,
      registry_site_id: row.registrySiteId,
      payload: (row.payload as Record<string, unknown>) ?? {},
    };
    const rawBody = JSON.stringify(envelope);
    const sentAt = Math.floor(Date.now() / 1000).toString();
    try {
      const res = await fetch(`${base}/api/spine/inbox`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          [SPINE_SIG_HEADER]: sign(rawBody, secret),
          [SPINE_SENT_AT_HEADER]: sentAt,
        },
        body: rawBody,
        signal: AbortSignal.timeout(8000),
        cache: "no-store",
      });
      if (res.ok) {
        await db.spineOutbox.update({ where: { id: row.id }, data: { deliveredAt: new Date() } });
        delivered++;
      } else {
        await db.spineOutbox.update({ where: { id: row.id }, data: { attempts: { increment: 1 }, lastError: `HTTP ${res.status}` } });
        failed++;
      }
    } catch (e) {
      await db.spineOutbox.update({ where: { id: row.id }, data: { attempts: { increment: 1 }, lastError: e instanceof Error ? e.message.slice(0, 300) : "error" } });
      failed++;
    }
  }

  const remaining = await db.spineOutbox.count({ where: { deliveredAt: null } });
  return NextResponse.json({ delivered, failed, remaining });
}
