import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { scorePage } from "@/lib/quality-score";

// Delivery read API (Part C): LinkSpy's cockpit reads a site's linked pages here.
// Service-key auth (DASHBOARD_BRIDGE_KEY), read-only, additive, rate-limited.
const RL = new Map<string, [number, number]>();
function rlOk(key: string): boolean {
  const now = Date.now();
  const b = RL.get(key);
  if (!b || now - b[0] >= 60_000) { RL.set(key, [now, 1]); return true; }
  if (b[1] >= 120) return false;
  b[1]++;
  return true;
}

export async function GET(req: NextRequest) {
  const secret = process.env.DASHBOARD_BRIDGE_KEY;
  if (!secret) return NextResponse.json({ error: "not configured" }, { status: 503 });
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!rlOk("bridge")) return NextResponse.json({ error: "rate limited" }, { status: 429 });

  const siteId = req.nextUrl.searchParams.get("registry_site_id");
  if (!siteId) return NextResponse.json({ error: "registry_site_id required" }, { status: 400 });

  const pages = await db.page.findMany({
    where: { registrySiteId: siteId },
    include: {
      project: { select: { id: true, clientId: true } },
      certificate: { include: { items: { select: { result: true } } } },
      issues: { select: { severity: true, status: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  const deliverables = pages.map((p) => {
    const items = p.certificate?.items ?? [];
    const passed = items.filter((i) => i.result === "PASSED").length;
    const failed = items.filter((i) => i.result === "FAILED").length;
    const na = items.filter((i) => i.result === "NA").length;
    const qa_score = p.certificate
      ? scorePage({ certStatus: p.certificate.status, items, issues: p.issues, delayDays: p.delayDays }).score
      : null;
    return {
      name: p.name,
      qa_page_ref: p.id,
      status: p.status, // IN_PROGRESS | IN_QA | LIVE
      checklist: { passed, failed, na, total: items.length },
      qa_score,
      signed_off_at: p.certificate?.completedAt ?? null,
      deep_link_path: `/dashboard/clients/${p.project.clientId}/${p.project.id}/${p.id}`,
    };
  });

  return NextResponse.json({
    registry_site_id: siteId,
    as_of: new Date().toISOString(),
    deliverables,
  });
}
