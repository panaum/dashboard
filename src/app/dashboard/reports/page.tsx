import Link from "next/link";
import { Download, ExternalLink } from "lucide-react";
import { db } from "@/lib/db";
import { Card } from "@/components/ui/card";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { PageHeader } from "@/components/shared/page-header";
import { Bar } from "@/components/reports/bar";
import { MonthStrip } from "@/components/reports/month-strip";
import { AddProjectForMonth } from "@/components/reports/add-project";
import { EditPageButton } from "@/components/forms/dialogs";
import { AnimatedNumber } from "@/components/shared/animated-number";
import { cn } from "@/lib/utils";
import {
  SEVERITIES,
  SEVERITY_TONE,
  label,
  type Severity,
} from "@/lib/constants";

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function monthLabel(m: string) {
  const [y, mo] = m.split("-");
  return `${MONTH_NAMES[Number(mo) - 1] ?? mo} ${y}`;
}

/** Current month as "YYYY-MM" — fallback target when no month tab is selected. */
function currentMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

const SEVERITY_BAR: Record<Severity, string> = {
  CRITICAL_HIGH: "bg-error",
  MEDIUM: "bg-warning",
  LOW: "bg-brand-blue",
  REPETITIVE: "bg-accent",
};

function Stat({
  value,
  unit,
  index = 0,
  decimals = 0,
}: {
  value: number;
  unit: string;
  index?: number;
  decimals?: number;
}) {
  return (
    <div
      className="animate-in rounded-xl border border-border-soft bg-card px-5 py-4 transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-sm"
      style={{ animationDelay: `${index * 50}ms` }}
    >
      <div className="text-[11px] font-semibold uppercase tracking-[0.07em] text-text-muted">
        {unit}
      </div>
      <div className="mt-2.5 text-[28px] font-semibold leading-none tracking-tight tabular-nums text-text-primary">
        <AnimatedNumber value={value} decimals={decimals} />
      </div>
    </div>
  );
}

export const metadata = { title: "Monthly report" };

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const { month } = await searchParams;

  // Available months (newest first)
  const monthRows = await db.page.findMany({
    where: { deliveryMonth: { not: null } },
    distinct: ["deliveryMonth"],
    select: { deliveryMonth: true },
    orderBy: { deliveryMonth: "desc" },
  });
  const months = monthRows
    .map((r) => r.deliveryMonth!)
    .filter(Boolean);

  // Clients + team for the "New deliverable" quick-add (adds into the viewed month).
  const [clients, team] = await Promise.all([
    db.client.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    db.teamMember.findMany({
      where: { active: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true, role: true },
    }),
  ]);

  // Accept any valid YYYY-MM (lets you open/plan a month with no pages yet),
  // otherwise default to the most recent month with data, else the current month.
  const isValidMonth = !!month && /^\d{4}-(0[1-9]|1[0-2])$/.test(month);
  const selected = isValidMonth ? month! : months[0] ?? currentMonth();
  const viewYear = selected.slice(0, 4);

  // Pages-delivered count per month of the viewed year — powers the month strip.
  const yearRows = await db.page.groupBy({
    by: ["deliveryMonth"],
    where: { deliveryMonth: { startsWith: `${viewYear}-` } },
    _count: { _all: true },
  });
  const monthCounts: Record<string, number> = {};
  for (const r of yearRows) {
    if (r.deliveryMonth) monthCounts[r.deliveryMonth.slice(5, 7)] = r._count._all;
  }

  const pages = await db.page.findMany({
    where: { deliveryMonth: selected },
    include: {
      developer: true,
      tester: true,
      project: { include: { client: true } },
      issues: { select: { severity: true } },
    },
    orderBy: { project: { name: "asc" } },
  });

  // Aggregates
  const totalPages = pages.length;
  const allIssues = pages.flatMap((p) => p.issues);
  const totalIssues = allIssues.length;
  const totalDelay = pages.reduce((s, p) => s + p.delayDays, 0);

  const severityCounts = SEVERITIES.reduce<Record<string, number>>((acc, s) => {
    acc[s] = allIssues.filter((i) => i.severity === s).length;
    return acc;
  }, {});

  // Platform breakdown
  const platformMap = new Map<string, number>();
  for (const p of pages) {
    platformMap.set(
      p.project.platform,
      (platformMap.get(p.project.platform) ?? 0) + 1,
    );
  }
  const platforms = [...platformMap.entries()].sort((a, b) => b[1] - a[1]);

  return (
    <>
      <PageHeader
        title="Monthly report"
        subtitle="Delivery and QA rollup — projects, issues and delays."
        action={
          <div className="flex items-center gap-2">
            {totalPages > 0 && (
              <a
                href={`/dashboard/reports/export?month=${selected}`}
                className={cn(buttonVariants({ variant: "secondary", size: "sm" }))}
              >
                <Download /> Export CSV
              </a>
            )}
            <AddProjectForMonth
              clients={clients}
              members={team}
              month={selected}
            />
          </div>
        }
      />

      <MonthStrip year={viewYear} selected={selected} counts={monthCounts} />

      {totalPages === 0 ? (
        <Card className="p-8 text-center">
          <p className="text-sm text-text-secondary">
            No pages delivered in {monthLabel(selected)} yet. Set a delivery month
            on pages, or use New deliverable to add one.
          </p>
        </Card>
      ) : (
        <div className="flex flex-col gap-6">
          {/* Summary */}
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <Stat value={totalPages} unit="Pages delivered" index={0} />
            <Stat value={totalIssues} unit="Total issues" index={1} />
            <Stat
              value={totalPages ? totalIssues / totalPages : 0}
              decimals={2}
              unit="Avg issues / page"
              index={2}
            />
            <Stat
              value={totalPages ? totalDelay / totalPages : 0}
              decimals={1}
              unit="Avg delay (days)"
              index={3}
            />
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            {/* Severity breakdown */}
            <Card className="p-5">
              <h2 className="mb-4 text-sm font-semibold text-text-primary">
                Issues by severity
              </h2>
              <div className="flex flex-col gap-3">
                {SEVERITIES.map((s, i) => {
                  const count = severityCounts[s];
                  const pct = totalIssues ? (count / totalIssues) * 100 : 0;
                  return (
                    <div key={s} className="flex items-center gap-3">
                      <div className="w-28 shrink-0">
                        <Badge tone={SEVERITY_TONE[s as Severity]}>
                          {label(s)}
                        </Badge>
                      </div>
                      <Bar pct={pct} colorClass={SEVERITY_BAR[s as Severity]} delay={i * 0.08} />
                      <span className="w-8 shrink-0 text-right text-sm font-semibold text-text-primary">
                        {count}
                      </span>
                    </div>
                  );
                })}
              </div>
            </Card>

            {/* Platform breakdown */}
            <Card className="p-5">
              <h2 className="mb-4 text-sm font-semibold text-text-primary">
                Pages by platform
              </h2>
              <div className="flex flex-col gap-3">
                {platforms.map(([plat, count], i) => {
                  const pct = totalPages ? (count / totalPages) * 100 : 0;
                  return (
                    <div key={plat} className="flex items-center gap-3">
                      <span className="w-28 shrink-0 text-[13px] text-text-secondary">
                        {label(plat)}
                      </span>
                      <Bar pct={pct} colorClass="bg-accent" delay={i * 0.08} />
                      <span className="w-8 shrink-0 text-right text-sm font-semibold text-text-primary">
                        {count}
                      </span>
                    </div>
                  );
                })}
              </div>
            </Card>
          </div>

          {/* Delivery table */}
          <Card className="overflow-hidden">
            <div className="border-b border-border-soft px-5 py-3">
              <h2 className="text-sm font-semibold text-text-primary">
                Delivery report
              </h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-border-soft text-xs uppercase tracking-wide text-text-muted">
                    <th className="px-5 py-2.5 font-medium">Page</th>
                    <th className="px-3 py-2.5 font-medium">Client</th>
                    <th className="px-3 py-2.5 font-medium">Developer</th>
                    <th className="px-3 py-2.5 font-medium">Tester</th>
                    <th className="px-3 py-2.5 text-right font-medium">Issues</th>
                    <th className="px-3 py-2.5 text-right font-medium">Delay</th>
                    <th className="px-5 py-2.5 text-right font-medium">
                      <span className="sr-only">Edit</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {pages.map((p) => {
                    // Prefer the public QA certificate (opt-in share link); fall
                    // back to the internal certificate view when none is minted.
                    const certHref = p.shareId
                      ? `/c/${p.shareId}`
                      : `/dashboard/clients/${p.project.client.id}/${p.project.id}/${p.id}/certificate`;
                    return (
                    <tr
                      key={p.id}
                      className="group border-b border-border-soft last:border-0 hover:bg-card-soft/50"
                    >
                      <td className="px-5 py-2.5 font-medium text-text-primary">
                        <Link
                          href={certHref}
                          className="inline-flex items-center gap-1.5 hover:text-accent hover:underline"
                          title="View QA certificate"
                        >
                          {p.name}
                          <ExternalLink className="size-3.5 text-text-muted opacity-0 transition-opacity group-hover:opacity-100" />
                        </Link>
                      </td>
                      <td className="px-3 py-2.5 text-text-secondary">
                        {p.project.client.name}
                      </td>
                      <td className="px-3 py-2.5 text-text-secondary">
                        {p.developer ? (
                          <span className="inline-flex items-center gap-2">
                            <Avatar name={p.developer.name} size="sm" />
                            {p.developer.name}
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-text-secondary">
                        {p.tester ? (
                          <span className="inline-flex items-center gap-2">
                            <Avatar name={p.tester.name} size="sm" />
                            {p.tester.name}
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-right text-text-primary">
                        {p.issues.length}
                      </td>
                      <td className="px-3 py-2.5 text-right text-text-secondary">
                        {p.delayDays}d
                      </td>
                      <td className="px-5 py-2.5 text-right">
                        <EditPageButton
                          clientId={p.project.client.id}
                          projectId={p.project.id}
                          members={team}
                          page={{
                            id: p.id,
                            name: p.name,
                            url: p.url,
                            status: p.status,
                            developerId: p.developerId,
                            testerId: p.testerId,
                            delayDays: p.delayDays,
                            deliveryMonth: p.deliveryMonth,
                          }}
                        />
                      </td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}
    </>
  );
}
