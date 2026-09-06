import { NextRequest, NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/auth";
import { db } from "@/lib/db";

// A stored fold screenshot (JPEG) for a saved device-preview run. These are
// the copies the Dashboard keeps for the two most recent runs of a page; the
// full-page images live on the preview service and are served by the view route.

export async function GET(req: NextRequest) {
  const denied = await requireApiAuth();
  if (denied) return denied;
  const runId = req.nextUrl.searchParams.get("runId");
  const profile = req.nextUrl.searchParams.get("profile");
  if (!runId || !profile) return NextResponse.json({ error: "runId and profile required" }, { status: 400 });
  const shot = await db.devicePreviewShot.findUnique({
    where: { runId_profileId: { runId, profileId: profile } },
    select: { image: true },
  });
  if (!shot) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return new NextResponse(new Uint8Array(shot.image), {
    status: 200,
    headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=86400, immutable" },
  });
}
