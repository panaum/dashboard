import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { db } from "@/lib/db";
import { scorePage } from "@/lib/quality-score";

// Inbound bridge: LinkSpy → Dashboard. Given a LinkSpy registry site id, return
// the QA state of every deliverable annotated with it, plus a relative in-app
// path LinkSpy signs into a handoff token (see src/lib/handoff-contract.ts).
//
// This is INBOUND SERVICE auth (shared bearer key), NOT the session cookie —
// the caller is a server, never a browser. src/lib/registry.ts is the outbound
// direction (Dashboard → LinkSpy) and shares nothing with this.
//
// Read-only: this route never writes.

// Deliverables link to a registry site via Page.registrySiteId (schema.prisma
// "Seam 1"): nullable, unset = a page with no LinkSpy annotation.
const CACHE_CONTROL = "private, max-age=900";

function authorized(req: NextRequest, key: string): boolean {
  const header = req.headers.get("authorization") ?? "";
  const prefix = "Bearer ";
  if (!header.startsWith(prefix)) return false;
  const presented = Buffer.from(header.slice(prefix.length));
  const expected = Buffer.from(key);
  // timingSafeEqual throws on length mismatch — length alone isn't a secret.
  if (presented.length !== expected.length) return false;
  return timingSafeEqual(presented, expected);
}

export async function GET(req: NextRequest) {
  const key = process.env.DASHBOARD_BRIDGE_KEY;
  if (!key) {
    return NextResponse.json({ error: "bridge_not_configured" }, { status: 503 });
  }
  if (!authorized(req, key)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const registrySiteId = req.nextUrl.searchParams.get("registry_site_id");
  if (!registrySiteId) {
    return NextResponse.json({ error: "registry_site_id_required" }, { status: 400 });
  }

  let pages;
  try {
    pages = await db.page.findMany({
      where: { registrySiteId },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        name: true,
        status: true,
        delayDays: true,
        projectId: true,
        project: { select: { clientId: true } },
        issues: { select: { severity: true, status: true } },
        certificate: {
          select: {
            status: true,
            completedAt: true,
            items: { select: { result: true } },
          },
        },
      },
    });
  } catch (e) {
    // Real error stays server-side; the caller only ever sees the opaque code.
    console.error("[registry-bridge/delivery] query failed", e);
    return NextResponse.json({ error: "query_failed" }, { status: 500 });
  }

  // No linked deliverables is a valid answer, not a 404.
  const deliverables = pages.map((page) => {
    const items = page.certificate?.items ?? [];
    const passed = items.filter((i) => i.result === "PASSED").length;
    const failed = items.filter((i) => i.result === "FAILED").length;
    const na = items.filter((i) => i.result === "NA").length;

    // Reuse the existing pure scorer. Provisional (nothing graded yet) reports
    // as null rather than a number that would read as a real grade.
    const score = scorePage({
      certStatus: page.certificate?.status ?? null,
      items,
      issues: page.issues,
      delayDays: page.delayDays,
    });

    return {
      name: page.name,
      qa_page_ref: page.id,
      status: page.status,
      checklist: { passed, failed, na, total: items.length },
      qa_score: score.provisional ? null : score.score,
      signed_off_at: page.certificate?.completedAt?.toISOString() ?? null,
      // Relative path to this page's checklist — LinkSpy appends it to a host
      // and signs it into a handoff token. Must stay app-relative (leading "/").
      deep_link_path: `/dashboard/clients/${page.project.clientId}/${page.projectId}/${page.id}`,
    };
  });

  return NextResponse.json(
    {
      registry_site_id: registrySiteId,
      as_of: new Date().toISOString(),
      deliverables,
    },
    { headers: { "Cache-Control": CACHE_CONTROL } },
  );
}
