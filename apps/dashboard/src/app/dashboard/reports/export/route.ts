import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { isAuthenticated } from "@/lib/auth";
import { toCsv, csvResponse } from "@/lib/csv";
import { label, monthLabel } from "@/lib/constants";

export async function GET(req: NextRequest) {
  if (!(await isAuthenticated())) {
    return new Response("Unauthorized", { status: 401 });
  }

  const param = req.nextUrl.searchParams.get("month") ?? undefined;

  const monthRows = await db.page.findMany({
    where: { deliveryMonth: { not: null } },
    distinct: ["deliveryMonth"],
    select: { deliveryMonth: true },
    orderBy: { deliveryMonth: "desc" },
  });
  const months = monthRows.map((r) => r.deliveryMonth!).filter(Boolean);
  const selected = param && months.includes(param) ? param : months[0] ?? null;

  const pages = await db.page.findMany({
    where: selected ? { deliveryMonth: selected } : {},
    orderBy: [{ project: { client: { name: "asc" } } }, { name: "asc" }],
    include: {
      project: { include: { client: true } },
      developer: true,
      tester: true,
      _count: { select: { issues: true } },
    },
  });

  const csv = toCsv(
    [
      "Client",
      "Project",
      "Page",
      "Platform",
      "Status",
      "Developer",
      "Tester",
      "Issues",
      "Delay (days)",
      "Delivery month",
    ],
    pages.map((p) => [
      p.project.client.name,
      p.project.name,
      p.name,
      label(p.project.platform),
      label(p.status),
      p.developer?.name ?? "",
      p.tester?.name ?? "",
      p._count.issues,
      p.delayDays,
      p.deliveryMonth ? monthLabel(p.deliveryMonth) : "",
    ]),
  );

  return csvResponse(csv, `delivery-report${selected ? `-${selected}` : ""}.csv`);
}
