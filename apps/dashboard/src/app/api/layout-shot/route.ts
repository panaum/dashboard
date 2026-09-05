import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireApiAuth } from "@/lib/auth";

// Serves a stored screenshot. Separate from the linkspy proxies because these
// images come from our own database, not the checker service — this is what
// makes an older run still viewable after its job on Railway has expired.

export async function GET(req: NextRequest) {
  const denied = await requireApiAuth();
  if (denied) return denied;

  const runId = req.nextUrl.searchParams.get("runId");
  const width = Number(req.nextUrl.searchParams.get("width"));
  if (!runId || !Number.isFinite(width)) {
    return NextResponse.json({ error: "runId and width required" }, { status: 400 });
  }

  const shot = await db.layoutShot.findUnique({
    where: { runId_width: { runId, width } },
    select: { image: true },
  });
  if (!shot) return NextResponse.json({ error: "not_found" }, { status: 404 });

  return new NextResponse(new Uint8Array(shot.image), {
    status: 200,
    headers: {
      "Content-Type": "image/jpeg",
      // A stored run never changes, so it can be cached hard — but privately:
      // these are client pages, never a shared or public cache.
      "Cache-Control": "private, max-age=86400, immutable",
    },
  });
}
