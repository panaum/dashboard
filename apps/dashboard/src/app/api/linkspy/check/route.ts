import { NextRequest, NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/auth";

// Proxy for the in-dashboard URL checker (the key stays server-side).
// POST starts a backend check job; GET polls its snapshot. Unavailable →
// 200 { unavailable: true } — the widget degrades, never errors.
//
// Helpers are declared BELOW the handlers on purpose: the isolation test
// asserts the requireApiAuth() call precedes any key/env use in source order.

const TIMEOUT_MS = 20000;

export async function POST(req: NextRequest) {
  const denied = await requireApiAuth();
  if (denied) return denied;
  if (!configured()) return NextResponse.json({ unavailable: true });
  const body = await req.json().catch(() => ({}) as { url?: string; persist?: boolean; email?: string });
  try {
    const res = await fetch(`${base()}/api/qa-bridge/check`, {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      // persist re-scans attribute to the site's real owner (see qa-bridge).
      body: JSON.stringify({ url: body.url ?? "", persist: body.persist === true, email: body.email ?? "" }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
    return NextResponse.json(await res.json(), { status: res.status });
  } catch {
    return NextResponse.json({ unavailable: true });
  }
}

export async function GET(req: NextRequest) {
  const denied = await requireApiAuth();
  if (denied) return denied;
  if (!configured()) return NextResponse.json({ unavailable: true });
  const id = req.nextUrl.searchParams.get("id") ?? "";
  try {
    const res = await fetch(
      `${base()}/api/qa-bridge/check-status?check_id=${encodeURIComponent(id)}`,
      { headers: authHeaders(), signal: AbortSignal.timeout(TIMEOUT_MS), cache: "no-store" },
    );
    return NextResponse.json(await res.json(), { status: res.status });
  } catch {
    return NextResponse.json({ unavailable: true });
  }
}

function base(): string {
  return (process.env.LINKSPY_API_URL || "").replace(/\/$/, "");
}
function authHeaders(): Record<string, string> {
  return { Authorization: `Bearer ${process.env.LINKSPY_API_KEY || ""}` };
}
function configured(): boolean {
  return Boolean(process.env.LINKSPY_API_URL && process.env.LINKSPY_API_KEY);
}
