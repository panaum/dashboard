import { NextRequest, NextResponse } from "next/server";
import { handoffUrl } from "@/lib/handoff-contract";

// Sign a handoff link SERVER-SIDE so SPINE_SECRET never reaches the browser.
// POST { targetPath, base? } → { url }. base defaults to the LinkSpy app (this
// app hands off outward to LinkSpy). Requires an authenticated session cookie.
export async function POST(req: NextRequest) {
  if (!req.cookies.get("session")?.value) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const secret = process.env.SPINE_SECRET ?? "";
  if (!secret) return NextResponse.json({ error: "not configured" }, { status: 503 });
  let body: { targetPath?: string; base?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "bad json" }, { status: 400 }); }
  const targetPath = body.targetPath ?? "";
  if (!targetPath.startsWith("/")) return NextResponse.json({ error: "bad target" }, { status: 400 });
  const base = body.base || process.env.LINKSPY_APP_URL || "";
  if (!base) return NextResponse.json({ error: "no target base" }, { status: 400 });
  return NextResponse.json({ url: handoffUrl(base, targetPath, secret, Math.floor(Date.now() / 1000)) });
}
