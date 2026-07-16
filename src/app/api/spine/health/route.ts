import { NextResponse } from "next/server";
import { db } from "@/lib/db";

// Internal health: outbox undelivered count + last delivery time. Best-effort.
export async function GET() {
  try {
    const [undelivered, lastDelivered] = await Promise.all([
      db.spineOutbox.count({ where: { deliveredAt: null } }),
      db.spineOutbox.findFirst({ where: { deliveredAt: { not: null } }, orderBy: { deliveredAt: "desc" }, select: { deliveredAt: true } }),
    ]);
    return NextResponse.json({
      emit: process.env.SPINE_EMIT === "1",
      undelivered,
      last_delivered_at: lastDelivered?.deliveredAt ?? null,
    });
  } catch {
    return NextResponse.json({ unavailable: true });
  }
}
