import { NextRequest, NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/auth";

// One screenshot from a finished responsive sweep, proxied as bytes.
//
// It is a separate route from the monitor proxy because that one wraps every
// response in NextResponse.json(); an image has to pass through untouched.
// The service key stays server-side here as everywhere else.

const TIMEOUT_MS = 20000;

export async function GET(req: NextRequest) {
  const denied = await requireApiAuth();
  if (denied) return denied;

  const base = (process.env.LINKSPY_API_URL || "").replace(/\/$/, "");
  const key = process.env.LINKSPY_API_KEY || "";
  if (!base || !key) return NextResponse.json({ unavailable: true });

  const id = req.nextUrl.searchParams.get("id");
  const width = req.nextUrl.searchParams.get("width");
  if (!id || !width) {
    return NextResponse.json({ error: "id and width required" }, { status: 400 });
  }

  try {
    const res = await fetch(
      `${base}/api/qa-bridge/monitor/responsive-shot` +
        `?check_id=${encodeURIComponent(id)}&width=${encodeURIComponent(width)}`,
      {
        headers: { Authorization: `Bearer ${key}` },
        signal: AbortSignal.timeout(TIMEOUT_MS),
        cache: "no-store",
      },
    );
    if (!res.ok) return NextResponse.json({ error: "not_found" }, { status: res.status });
    return new NextResponse(await res.arrayBuffer(), {
      status: 200,
      headers: {
        "Content-Type": res.headers.get("content-type") ?? "image/jpeg",
        // Screenshots live only as long as the job, so caching is per-viewer
        // and short. They are client data — never a shared or public cache.
        "Cache-Control": "private, max-age=600",
      },
    });
  } catch {
    return NextResponse.json({ unavailable: true });
  }
}
