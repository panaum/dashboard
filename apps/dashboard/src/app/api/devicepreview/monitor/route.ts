import { NextRequest, NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/auth";

// Proxy for the devicepreview service (the key stays server-side). POST starts
// a run; GET polls it (?id=) or lists retained runs (?view=runs&url=).
// Unavailable → 200 { unavailable: true } — the section degrades, never errors.
//
// Helpers are declared BELOW the handlers: the isolation test asserts the
// requireApiAuth() call precedes any key/env use in source order.

const TIMEOUT_MS = 20000;
const SCOPES = new Set(["primary", "all"]);

export async function GET(req: NextRequest) {
  const denied = await requireApiAuth();
  if (denied) return denied;
  if (!configured()) return NextResponse.json({ unavailable: true });
  const p = req.nextUrl.searchParams;
  if (p.get("view") === "runs") {
    const url = p.get("url");
    if (!url) return NextResponse.json({ error: "url required" }, { status: 400 });
    return forward(`/api/devicepreview/runs?url=${encodeURIComponent(url)}&limit=10`);
  }
  const id = p.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  return forward(`/api/devicepreview/status?run_id=${encodeURIComponent(id)}`);
}

export async function POST(req: NextRequest) {
  const denied = await requireApiAuth();
  if (denied) return denied;
  if (!configured()) return NextResponse.json({ unavailable: true });
  const body = await req.json().catch(() => ({}));
  const url = typeof body?.url === "string" ? body.url : "";
  if (!/^https?:\/\/\S+$/.test(url)) return NextResponse.json({ error: "a valid http(s) url is required" }, { status: 400 });
  const scope = SCOPES.has(body?.scope) ? body.scope : "primary";
  const payload: Record<string, unknown> = {
    url,
    // "all" is every profile including the 260px edge-tier canary; "primary" is the fourteen real ones.
    ...(scope === "all" ? { devices: "all" } : {}),
    ...(typeof body?.baseline === "string" && body.baseline ? { baseline: body.baseline } : {}),
  };
  return forward("/api/devicepreview/run", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

async function forward(path: string, init: RequestInit = {}): Promise<NextResponse> {
  const base = (process.env.DEVICEPREVIEW_URL || "").replace(/\/$/, "");
  try {
    const res = await fetch(`${base}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${process.env.DEVICEPREVIEW_KEY || ""}`, ...(init.headers ?? {}) },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
    return NextResponse.json(await res.json(), { status: res.status });
  } catch {
    return NextResponse.json({ unavailable: true });
  }
}

function configured(): boolean {
  return Boolean(process.env.DEVICEPREVIEW_URL && process.env.DEVICEPREVIEW_KEY);
}
