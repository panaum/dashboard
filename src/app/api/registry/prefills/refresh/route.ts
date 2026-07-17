import { NextRequest, NextResponse } from "next/server";
import { registryConfigured } from "@/lib/registry";

// Proxy: re-run the LinkSpy battery for a deliverable (rate-limited on the
// LinkSpy side). Key stays server-side.
export async function POST(req: NextRequest) {
  const deliverableId = req.nextUrl.searchParams.get("deliverable_id");
  if (!deliverableId) return NextResponse.json({ error: "deliverable_id required" }, { status: 400 });
  if (!registryConfigured()) return NextResponse.json({ unavailable: true });
  const base = (process.env.LINKSPY_API_URL || "").replace(/\/$/, "");
  try {
    const res = await fetch(`${base}/api/qa-bridge/prefills/refresh?deliverable_id=${encodeURIComponent(deliverableId)}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.LINKSPY_API_KEY || ""}` },
      signal: AbortSignal.timeout(8000),
      cache: "no-store",
    });
    return new NextResponse(await res.text(), { status: res.status, headers: { "Content-Type": "application/json" } });
  } catch {
    return NextResponse.json({ unavailable: true });
  }
}
