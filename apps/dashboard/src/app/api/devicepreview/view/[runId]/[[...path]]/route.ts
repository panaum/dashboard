import { NextRequest, NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/auth";
import { db } from "@/lib/db";

// The gallery for a saved run, served from the devicepreview service while it
// still retains the run. report.html is one self-contained file that refers to
// its images by relative path, so it renders inside an iframe at
// /api/devicepreview/view/<runId>/report.html and every image it asks for
// (<profile>/full.png, diff.png, report.json) resolves back through this route.
//
// Helpers are declared BELOW the handler (isolation test: auth precedes env/db use).

const TIMEOUT_MS = 30000;

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ runId: string; path?: string[] }> },
) {
  const denied = await requireApiAuth();
  if (denied) return denied;
  const { runId, path } = await params;
  const rel = (path ?? ["report.html"]).join("/");
  if (!/^[A-Za-z0-9_.\-]+(\/[A-Za-z0-9_.\-]+)*$/.test(rel) || rel.includes("..")) {
    return NextResponse.json({ error: "bad path" }, { status: 400 });
  }
  const run = await db.devicePreviewRun.findUnique({ where: { id: runId }, select: { serviceRunId: true } });
  if (!run) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (!configured()) return gone("The preview service is not configured on this deployment.");

  const base = (process.env.DEVICEPREVIEW_URL || "").replace(/\/$/, "");
  const target = `${base}/api/devicepreview/file?run_id=${encodeURIComponent(run.serviceRunId)}&path=${encodeURIComponent(rel)}`;
  let upstream: Response;
  try {
    upstream = await fetch(target, {
      headers: { Authorization: `Bearer ${process.env.DEVICEPREVIEW_KEY || ""}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
  } catch {
    return rel.endsWith("report.html") ? gone("The preview service could not be reached.") : NextResponse.json({ unavailable: true }, { status: 503 });
  }
  if (!upstream.ok) {
    return rel.endsWith("report.html")
      ? gone("This run's gallery is no longer kept on the preview service. The verdicts and fold screenshots below are still here.")
      : NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  return new NextResponse(upstream.body, {
    status: 200,
    headers: {
      "Content-Type": upstream.headers.get("content-type") ?? "application/octet-stream",
      // Files of a finished run never change.
      "Cache-Control": "private, max-age=86400, immutable",
    },
  });
}

function gone(message: string): NextResponse {
  const html = `<!doctype html><meta charset="utf-8"><body style="margin:0;font:14px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#5b6473;background:#f4f5f8;display:grid;place-items:center;min-height:100vh"><p style="max-width:48ch;text-align:center;padding:24px">${message.replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c] as string))}</p></body>`;
  return new NextResponse(html, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}

function configured(): boolean {
  return Boolean(process.env.DEVICEPREVIEW_URL && process.env.DEVICEPREVIEW_KEY);
}
