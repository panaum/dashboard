import { NextRequest, NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/auth";

// Proxy for the monitoring dashboard (the key stays server-side). GET serves
// the read views; POST adds a site; DELETE removes one. Unavailable →
// 200 { unavailable: true } — the grid degrades, never errors.
//
// Helpers are declared BELOW the handlers: the isolation test asserts the
// requireApiAuth() call precedes any key/env use in source order.

const TIMEOUT_MS = 20000;
const XRAY_TIMEOUT_MS = 60000;

const VIEWS: Record<string, (p: URLSearchParams) => string | null> = {
  dashboard: () => "/api/qa-bridge/monitor/dashboard",
  watchdog: () => "/api/qa-bridge/monitor/watchdog",
  fragility: () => "/api/qa-bridge/monitor/fragility",
  history: (p) => {
    const url = p.get("url");
    if (!url) return null;
    return `/api/qa-bridge/monitor/history?url=${encodeURIComponent(url)}&email=${encodeURIComponent(p.get("email") ?? "anonymous")}`;
  },
  issues: (p) => {
    const url = p.get("url");
    if (!url) return null;
    return `/api/qa-bridge/monitor/issues?url=${encodeURIComponent(url)}`;
  },
  // On-demand: its own headless capture, so it is never part of a scan.
  xray: (p) => {
    const url = p.get("url");
    if (!url) return null;
    return `/api/qa-bridge/monitor/xray?url=${encodeURIComponent(url)}`;
  },
};

export async function GET(req: NextRequest) {
  const denied = await requireApiAuth();
  if (denied) return denied;
  if (!configured()) return NextResponse.json({ unavailable: true });
  const name = req.nextUrl.searchParams.get("view") ?? "";
  const view = VIEWS[name];
  const path = view?.(req.nextUrl.searchParams);
  if (!path) return NextResponse.json({ error: "unknown view" }, { status: 400 });
  // X-ray runs a fresh headless capture + full-page screenshot — seconds, not
  // milliseconds — so it gets its own budget rather than the read timeout.
  return forward(path, {}, name === "xray" ? XRAY_TIMEOUT_MS : TIMEOUT_MS);
}

export async function POST(req: NextRequest) {
  const denied = await requireApiAuth();
  if (denied) return denied;
  if (!configured()) return NextResponse.json({ unavailable: true });
  const body = await req.json().catch(() => ({}));
  return forward("/api/qa-bridge/monitor/sites", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export async function DELETE(req: NextRequest) {
  const denied = await requireApiAuth();
  if (denied) return denied;
  if (!configured()) return NextResponse.json({ unavailable: true });
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  return forward(`/api/qa-bridge/monitor/sites/${encodeURIComponent(id)}`, { method: "DELETE" });
}

async function forward(
  path: string,
  init: RequestInit = {},
  timeoutMs: number = TIMEOUT_MS,
): Promise<NextResponse> {
  const base = (process.env.LINKSPY_API_URL || "").replace(/\/$/, "");
  try {
    const res = await fetch(`${base}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${process.env.LINKSPY_API_KEY || ""}`,
        ...(init.headers ?? {}),
      },
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
    });
    return NextResponse.json(await res.json(), { status: res.status });
  } catch {
    return NextResponse.json({ unavailable: true });
  }
}

function configured(): boolean {
  return Boolean(process.env.LINKSPY_API_URL && process.env.LINKSPY_API_KEY);
}
