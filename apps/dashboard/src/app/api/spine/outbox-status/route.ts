import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

// Read endpoint for LinkSpy's nightly reconcile: per-deliverable delivered vs
// undelivered outbox counts. Protected by the shared SPINE_SECRET (Bearer).
export async function GET(req: NextRequest) {
  const secret = process.env.SPINE_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const ids = (req.nextUrl.searchParams.get("ids") || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!ids.length) return NextResponse.json({ status: {} });

  const rows = await db.spineOutbox.findMany({
    where: { registryDeliverableId: { in: ids } },
    select: { registryDeliverableId: true, deliveredAt: true },
  });
  const status: Record<string, { delivered: number; undelivered: number }> = {};
  for (const id of ids) status[id] = { delivered: 0, undelivered: 0 };
  for (const r of rows) {
    const k = r.registryDeliverableId;
    if (!k) continue;
    (status[k] ??= { delivered: 0, undelivered: 0 });
    if (r.deliveredAt) status[k].delivered++;
    else status[k].undelivered++;
  }
  return NextResponse.json({ status });
}
