import Link from "next/link";
import { Download } from "lucide-react";
import { db } from "@/lib/db";
import { Card } from "@/components/ui/card";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/ui/status-badge";
import { PageHeader } from "@/components/shared/page-header";
import { OpenSite } from "@/components/shared/open-site";
import { Select } from "@/components/ui/field";
import { Button, buttonVariants } from "@/components/ui/button";
import { buildPageWhere, hasAnyFilter } from "@/lib/page-search";
import { cn } from "@/lib/utils";
import {
  PLATFORMS,
  STATUSES,
  label,
  monthLabel,
  type Status,
} from "@/lib/constants";

export const metadata = { title: "Search" };

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{
    platform?: string;
    status?: string;
    developerId?: string;
    testerId?: string;
    month?: string;
  }>;
}) {
  const sp = await searchParams;

  const [members, monthRows] = await Promise.all([
    db.teamMember.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true, role: true },
    }),
    db.page.findMany({
      where: { deliveryMonth: { not: null } },
      distinct: ["deliveryMonth"],
      select: { deliveryMonth: true },
      orderBy: { deliveryMonth: "desc" },
    }),
  ]);
  const months = monthRows.map((m) => m.deliveryMonth!).filter(Boolean);

  // Role-aware dropdowns: developers = DEVELOPER/BOTH; testers = pure TESTER only.
  const developers = members.filter((m) => m.role !== "TESTER");
  const testers = members.filter((m) => m.role === "TESTER");

  const hasFilters = hasAnyFilter(sp);
  const exportHref = `/dashboard/search/export?${new URLSearchParams(
    Object.entries(sp).filter(([, v]) => v) as [string, string][],
  ).toString()}`;

  const results = hasFilters
    ? await db.page.findMany({
        where: buildPageWhere(sp),
        take: 100,
        orderBy: { name: "asc" },
        include: {
          project: { include: { client: true } },
          developer: true,
          tester: true,
          _count: { select: { issues: true } },
        },
      })
    : [];

  const fieldCls = "w-auto text-[13px]";

  return (
    <>
      <PageHeader title="Search" subtitle="Find any client, project or page." />

      <form method="get" className="mb-6 flex flex-wrap items-end gap-2">
        <Select name="platform" defaultValue={sp.platform ?? ""} className={`${fieldCls} w-auto`}>
          <option value="">Any platform</option>
          {PLATFORMS.map((p) => (
            <option key={p} value={p}>{label(p)}</option>
          ))}
        </Select>
        <Select name="status" defaultValue={sp.status ?? ""} className={`${fieldCls} w-auto`}>
          <option value="">Any status</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>{label(s)}</option>
          ))}
        </Select>
        <Select name="developerId" defaultValue={sp.developerId ?? ""} className={fieldCls}>
          <option value="">Any developer</option>
          {developers.map((m) => (
            <option key={m.id} value={m.id}>{m.name}</option>
          ))}
        </Select>
        <Select name="testerId" defaultValue={sp.testerId ?? ""} className={fieldCls}>
          <option value="">Any tester</option>
          {testers.map((m) => (
            <option key={m.id} value={m.id}>{m.name}</option>
          ))}
        </Select>
        <Select name="month" defaultValue={sp.month ?? ""} className={`${fieldCls} w-auto`}>
          <option value="">Any month</option>
          {months.map((m) => (
            <option key={m} value={m}>{monthLabel(m)}</option>
          ))}
        </Select>
        <Button type="submit" size="sm">Search</Button>
        {hasFilters && (
          <Link
            href="/dashboard/search"
            className="px-2 py-2 text-[13px] text-text-secondary hover:text-text-primary"
          >
            Clear
          </Link>
        )}
      </form>

      {hasFilters ? (
        <>
          <div className="mb-3 flex items-center justify-between gap-3">
            <p className="text-[13px] text-text-secondary">
              {results.length} result{results.length === 1 ? "" : "s"}
              {results.length === 100 ? " (showing first 100)" : ""}
            </p>
            {results.length > 0 && (
              <a
                href={exportHref}
                className={cn(buttonVariants({ variant: "secondary", size: "sm" }))}
              >
                <Download /> Export CSV
              </a>
            )}
          </div>
          {results.length === 0 ? (
            <div className="rounded-xl border border-border-soft bg-card px-4 py-12 text-center text-sm text-text-secondary">
              No matches. Try fewer filters.
            </div>
          ) : (
            <div className="overflow-hidden rounded-xl border border-border-soft bg-card">
              {results.map((pg) => (
                <div
                  key={pg.id}
                  className="group flex items-center gap-3 border-t border-border-soft px-4 py-3 transition-colors first:border-t-0 hover:bg-card-soft sm:gap-4"
                >
                  <Link
                    href={`/dashboard/clients/${pg.project.clientId}/${pg.projectId}/${pg.id}`}
                    className="flex min-w-0 flex-1 items-center gap-3 sm:gap-4"
                  >
                    {pg.developer ? (
                      <Avatar name={pg.developer.name} size="sm" />
                    ) : (
                      <span className="flex size-7 shrink-0 items-center justify-center rounded-full border border-dashed border-border-soft text-[11px] text-text-muted">
                        —
                      </span>
                    )}
                    <div className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-sm font-medium text-text-primary group-hover:underline">
                        {pg.name}
                      </span>
                      <span className="truncate text-[13px] text-text-secondary">
                        {pg.project.client.name} ·{" "}
                        {pg.deliveryMonth ? monthLabel(pg.deliveryMonth) : "—"}
                      </span>
                    </div>
                  </Link>
                  <Badge tone="neutral" className="hidden shrink-0 md:inline-flex">
                    {label(pg.project.platform)}
                  </Badge>
                  <Badge
                    tone={pg._count.issues > 0 ? "warning" : "success"}
                    className="hidden shrink-0 sm:inline-flex"
                  >
                    {pg._count.issues} issue{pg._count.issues === 1 ? "" : "s"}
                  </Badge>
                  <StatusBadge status={pg.status as Status} />
                  <OpenSite url={pg.url} />
                </div>
              ))}
            </div>
          )}
        </>
      ) : (
        <Card className="p-10 text-center">
          <p className="text-sm text-text-secondary">
            Pick a filter to begin.
          </p>
          <p className="mt-2 inline-flex items-center gap-1.5 text-[13px] text-text-muted">
            Tip: press
            <kbd className="rounded-md border border-border-soft bg-card-soft px-1.5 py-0.5 text-[11px] font-medium text-text-secondary">
              ⌘K
            </kbd>
            anywhere for quick search.
          </p>
        </Card>
      )}
    </>
  );
}
