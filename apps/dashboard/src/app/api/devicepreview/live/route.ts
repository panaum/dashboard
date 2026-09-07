import { NextRequest, NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/auth";
import { db } from "@/lib/db";

// A downscaled JPEG of a capture, straight from the preview service while it
// still retains the run: the full page for the device frame (a phone's PNG
// can be 18MB; this is ~1MB), or the fold. 404 when the service has pruned
// the run — the caller falls back to the fold the Dashboard stored.
//
// Helper below the handler (isolation test: auth precedes env/db use).

const TIMEOUT_MS = 30000;
const KINDS = new Set(["full", "fold"]);

export async function GET(req: NextRequest) {
  const denied = await requireApiAuth();
  if (denied) return denied;
  const p = req.nextUrl.searchParams;
  const runId = p.get("runId") ?? "";
  const profile = p.get("profile") ?? "";
  const kind = p.get("kind") ?? "full";
  const width = Math.min(1600, Math.max(300, Number(p.get("w") ?? 900) || 900));
  if (!runId || !/^[A-Za-z0-9_-]+$/.test(profile) || !KINDS.has(kind)) {
    return NextResponse.json({ error: "runId, profile and kind=full|fold required" }, { status: 400 });
  }
  const run = await db.devicePreviewRun.findUnique({ where: { id: runId }, select: { serviceRunId: true } });
  if (!run) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (!configured()) return NextResponse.json({ unavailable: true }, { status: 503 });
  const base = (process.env.DEVICEPREVIEW_URL || "").replace(/\/$/, "");
  const target = `${base}/api/devicepreview/image?run_id=${encodeURIComponent(run.serviceRunId)}&profile=${encodeURIComponent(profile)}&kind=${kind}&max_width=${width}`;
  try {
    const upstream = await fetch(target, {
      headers: { Authorization: `Bearer ${process.env.DEVICEPREVIEW_KEY || ""}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
    if (!upstream.ok) return NextResponse.json({ error: "not_found" }, { status: 404 });
    return new NextResponse(upstream.body, {
      status: 200,
      headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=86400, immutable" },
    });
  } catch {
    return NextResponse.json({ unavailable: true }, { status: 503 });
  }
}

function configured(): boolean {
  return Boolean(process.env.DEVICEPREVIEW_URL && process.env.DEVICEPREVIEW_KEY);
}
