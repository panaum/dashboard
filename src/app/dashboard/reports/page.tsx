import Link from "next/link";
import { Download } from "lucide-react";
import { db } from "@/lib/db";
import { Card } from "@/components/ui/card";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { PageHeader } from "@/components/shared/page-header";
import { Bar } from "@/components/reports/bar";
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

const SEVERITY_BAR: Record<Severity, string> = {
  CRITICAL_HIGH: "bg-error",
  MEDIUM: "bg-warning",
  LOW: "bg-brand-blue",
  REPETITIVE: "bg-brand-purple",
};

function Stat({ value, unit }: { value: string | number; unit: string }) {
  return (
    <div className="rounded-xl border border-border-soft bg-card px-5 py-4">
      <div className="text-[11px] font-semibold uppercase tracking-[0.07em] text-text-muted">
        {unit}
      </div>
      <div className="mt-2.5 text-[28px] font-semibold leading-none tracking-tight tabular-nums text-text-primary">
        {value}
      </div>
    </div>
  );
}

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

  const selected = month && months.includes(month) ? month : months[0] ?? null;

  const pages = await db.page.findMany({
    where: selected ? { deliveryMonth: selected } : {},
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
  const avgIssues = totalPages ? (totalIssues / totalPages).toFixed(2) : "0";
  const totalDelay = pages.reduce((s, p) => s + p.delayDays, 0);
  const avgDelay = totalPages ? (totalDelay / totalPages).toFixed(1) : "0";

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
          totalPages > 0 ? (
            <a
              href={`/dashboard/reports/export${selected ? `?month=${selected}` : ""}`}
              className={cn(buttonVariants({ variant: "secondary", size: "sm" }))}
            >
              <Download /> Export CSV
            </a>
          ) : undefined
        }
      />

      {/* Month picker */}
      {months.length > 0 && (
        <div className="mb-6 flex flex-wrap gap-2">
          {months.map((m) => {
            const active = m === selected;
            return (
              <Link
                key={m}
                href={`/dashboard/reports?month=${m}`}
                className={`rounded-full px-3.5 py-1.5 text-[13px] font-semibold transition-all ${
                  active
                    ? "bg-brand-primary text-text-on-dark shadow-sm"
                    : "border border-border-soft bg-card text-text-secondary hover:border-brand-purple/40 hover:text-text-primary"
                }`}
              >
                {monthLabel(m)}
              </Link>
            );
          })}
        </div>
      )}

      {totalPages === 0 ? (
        <Card className="p-8 text-center">
          <p className="text-sm text-text-secondary">
            No pages delivered{selected ? ` in ${monthLabel(selected)}` : ""} yet.
            Set a delivery month on pages to populate this report.
          </p>
        </Card>
      ) : (
        <div className="flex flex-col gap-6">
          {/* Summary */}
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <Stat value={totalPages} unit="Pages delivered" />
            <Stat value={totalIssues} unit="Total issues" />
            <Stat value={avgIssues} unit="Avg issues / page" />
            <Stat value={`${avgDelay}`} unit="Avg delay (days)" />
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
                      <Bar pct={pct} colorClass="bg-brand-purple" delay={i * 0.08} />
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
                    <th className="px-5 py-2.5 text-right font-medium">Delay</th>
                  </tr>
                </thead>
                <tbody>
                  {pages.map((p) => (
                    <tr
                      key={p.id}
                      className="border-b border-border-soft last:border-0 hover:bg-card-soft/50"
                    >
                      <td className="px-5 py-2.5 font-medium text-text-primary">
                        {p.name}
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
                      <td className="px-5 py-2.5 text-right text-text-secondary">
                        {p.delayDays}d
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}
    </>
  );
}
