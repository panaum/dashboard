import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { isAuthenticated } from "@/lib/auth";
import { toCsv, csvResponse } from "@/lib/csv";
import { buildPageWhere, hasAnyFilter, type PageSearchParams } from "@/lib/page-search";
import { label, monthLabel } from "@/lib/constants";

export async function GET(req: NextRequest) {
  if (!(await isAuthenticated())) {
    return new Response("Unauthorized", { status: 401 });
  }

  const p = req.nextUrl.searchParams;
  const sp: PageSearchParams = {
    platform: p.get("platform") ?? undefined,
    status: p.get("status") ?? undefined,
    developerId: p.get("developerId") ?? undefined,
    testerId: p.get("testerId") ?? undefined,
    month: p.get("month") ?? undefined,
  };

  const pages = hasAnyFilter(sp)
    ? await db.page.findMany({
        where: buildPageWhere(sp),
        take: 1000,
        orderBy: { name: "asc" },
        include: {
          project: { include: { client: true } },
          developer: true,
          tester: true,
          _count: { select: { issues: true } },
        },
      })
    : [];

  const csv = toCsv(
    [
      "Page",
      "Client",
      "Project",
      "Platform",
      "Status",
      "Developer",
      "Tester",
      "Issues",
      "Delivery month",
    ],
    pages.map((pg) => [
      pg.name,
      pg.project.client.name,
      pg.project.name,
      label(pg.project.platform),
      label(pg.status),
      pg.developer?.name ?? "",
      pg.tester?.name ?? "",
      pg._count.issues,
      pg.deliveryMonth ? monthLabel(pg.deliveryMonth) : "",
    ]),
  );

  return csvResponse(csv, "search-results.csv");
}
