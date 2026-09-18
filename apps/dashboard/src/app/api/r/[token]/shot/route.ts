import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { nowSeconds, verifyReportLink } from "@/lib/layout-checks/report-link";

// A device's fold for a shared report. The share token is the credential: it
// is verified against SPINE_SECRET before anything is read, and it names the
// run, so a valid token cannot reach any other run's pictures. 404 for an
// invalid or expired token, like the page.
export async function GET(req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const v = verifyReportLink(token, process.env.SPINE_SECRET || "", nowSeconds());
  if (!v.ok) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const profile = req.nextUrl.searchParams.get("profile") ?? "";
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(profile)) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const shot = await db.devicePreviewShot.findUnique({ where: { runId_profileId: { runId: v.runId, profileId: profile } }, select: { image: true } });
  if (!shot) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return new NextResponse(new Uint8Array(shot.image), {
    status: 200,
    headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=3600" },
  });
}
