import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { db } from "@/lib/db";
import { Badge } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/avatar";
import { PageHeader } from "@/components/shared/page-header";
import { AnimatedNumber } from "@/components/shared/animated-number";
import { StatRailBar } from "@/components/shared/stat-rail-bar";
import { AttentionPanel } from "@/components/shared/attention-panel";
import { Bar } from "@/components/reports/bar";
import { buildAttention } from "@/lib/attention";
import {
  SEVERITIES,
  SEVERITY_TONE,
  STATUSES,
  label,
  type Severity,
  type Status,
} from "@/lib/constants";

const SEV_BAR: Record<Severity, string> = {
  CRITICAL_HIGH: "bg-error",
  MEDIUM: "bg-warning",
  LOW: "bg-brand-blue",
  REPETITIVE: "bg-accent",
};

const STATUS_DOT: Record<Status, string> = {
  IN_PROGRESS: "bg-warning",
  IN_QA: "bg-info",
  LIVE: "bg-success",
};

export const metadata = { title: "Overview" };

export default async function OverviewPage() {
  const [clients, projects, pages, openIssues, inQa, recentProjects, issues, pageStatuses, attentionPages] =
    await Promise.all([
      db.client.count(),
      db.project.count(),
      db.page.count(),
      db.issue.count({ where: { status: "OPEN" } }),
      db.page.count({ where: { status: "IN_QA" } }),
      db.project.findMany({
        take: 7,
        orderBy: { updatedAt: "desc" },
        include: { client: true, _count: { select: { pages: true } } },
      }),
      db.issue.findMany({ select: { severity: true } }),
      db.page.findMany({ select: { status: true } }),
      db.page.findMany({
        select: {
          id: true,
          name: true,
          status: true,
          delayDays: true,
          developerId: true,
          testerId: true,
          project: { select: { id: true, clientId: true, client: { select: { name: true } } } },
          certificate: { select: { status: true, items: { select: { result: true } } } },
          issues: { select: { severity: true, status: true } },
        },
      }),
    ]);

  const attention = buildAttention(
    attentionPages.map((p) => ({
      id: p.id,
      name: p.name,
      status: p.status,
      delayDays: p.delayDays,
      hasDeveloper: p.developerId !== null,
      hasTester: p.testerId !== null,
      certStatus: p.certificate?.status ?? null,
      items: p.certificate?.items ?? [],
      issues: p.issues,
      clientId: p.project.clientId,
      clientName: p.project.client.name,
      projectId: p.project.id,
    })),
  );

  const totalIssues = issues.length;
  const sevCount = (s: Severity) => issues.filter((i) => i.severity === s).length;
  const statusCount = (s: Status) =>
    pageStatuses.filter((p) => p.status === s).length;

  const max = Math.max(clients, projects, pages, 1);
  const STATS = [
    { label: "Clients", value: clients, descriptor: "Active", color: "bg-info", pct: (clients / max) * 100 },
    { label: "Projects", value: projects, descriptor: "In progress", color: "bg-success", pct: (projects / max) * 100 },
    { label: "Pages", value: pages, descriptor: "Total", color: "bg-warning", pct: (pages / max) * 100 },
    { label: "In QA", value: inQa, descriptor: "Pending review", color: "bg-text-muted", pct: pages ? (inQa / pages) * 100 : 0 },
    { label: "Open issues", value: openIssues, descriptor: "Unresolved", color: "bg-text-muted", pct: 0 },
  ];

  return (
    <>
      <PageHeader
        title="Overview"
        subtitle="Snapshot of clients, deliverables and QA across the team."
      />

      {/* Connected stats rail */}
      <div className="mb-9 grid grid-cols-5 divide-x divide-border-soft overflow-hidden rounded-xl border border-border-soft bg-card">
        {STATS.map((s) => (
          <div key={s.label} className="px-5 py-4">
            <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-text-muted">
              {s.label}
            </div>
            <div className="mt-2 text-[30px] font-semibold leading-none tracking-tight tabular-nums text-text-primary">
              <AnimatedNumber value={s.value} />
            </div>
            <StatRailBar pct={s.pct} color={s.color} />
            <div className="mt-2.5 text-[12px] text-text-muted">
              {s.descriptor}
            </div>
          </div>
        ))}
      </div>

      <AttentionPanel attention={attention} />

      <div className="grid gap-5 lg:grid-cols-3">
        {/* Recent projects */}
        <section className="lg:col-span-2">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-text-primary">
              Recent projects
            </h2>
            <Link
              href="/dashboard/clients"
              className="text-[13px] font-medium text-text-secondary transition-colors hover:text-text-primary"
            >
              View all clients →
            </Link>
          </div>

          <div className="divide-y divide-border-soft overflow-hidden rounded-xl border border-border-soft bg-card">
            {recentProjects.map((p, i) => (
              <Link
                key={p.id}
                href={`/dashboard/clients/${p.clientId}/${p.id}`}
                style={{ animationDelay: `${i * 45}ms` }}
                className="animate-in group flex items-center gap-3 px-4 py-3 transition-colors hover:bg-card-soft"
              >
                <Avatar name={p.client.name} size="sm" />
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-sm font-medium text-text-primary">
                    {p.name}
                  </span>
                  <span className="truncate text-[13px] text-text-secondary">
                    {p.client.name !== p.name ? `${p.client.name} · ` : ""}
                    {p._count.pages} page{p._count.pages === 1 ? "" : "s"}
                  </span>
                </div>
                <Badge tone="neutral" className="hidden shrink-0 sm:inline-flex">
                  {label(p.platform)}
                </Badge>
                <ChevronRight className="size-4 shrink-0 text-text-muted transition-transform duration-200 group-hover:translate-x-0.5" />
              </Link>
            ))}
            {recentProjects.length === 0 && (
              <div className="px-4 py-10 text-center text-sm text-text-secondary">
                No projects yet. Add your first client to get started.
              </div>
            )}
          </div>
        </section>

        {/* Right rail: live QA signal */}
        <div className="flex flex-col gap-5">
          <div
            className="animate-in rounded-xl border border-border-soft bg-card p-5"
            style={{ animationDelay: "120ms" }}
          >
            <div className="mb-4 flex items-baseline justify-between">
              <h2 className="text-sm font-semibold text-text-primary">
                Issues by severity
              </h2>
              <span className="text-[13px] tabular-nums text-text-muted">
                {totalIssues} total
              </span>
            </div>
            <div className="flex flex-col gap-3">
              {SEVERITIES.map((s, i) => {
                const count = sevCount(s);
                const pct = totalIssues ? (count / totalIssues) * 100 : 0;
                return (
                  <div key={s} className="flex items-center gap-3">
                    <span className="w-[104px] shrink-0">
                      <Badge tone={SEVERITY_TONE[s]} className="whitespace-nowrap">
                        {label(s)}
                      </Badge>
                    </span>
                    <Bar pct={pct} colorClass={SEV_BAR[s]} delay={i * 0.07} />
                    <span className="w-7 shrink-0 text-right text-sm font-semibold tabular-nums text-text-primary">
                      {count}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          <div
            className="animate-in rounded-xl border border-border-soft bg-card p-5"
            style={{ animationDelay: "180ms" }}
          >
            <h2 className="mb-4 text-sm font-semibold text-text-primary">
              Delivery pipeline
            </h2>
            <div className="flex flex-col gap-3">
              {STATUSES.map((s, i) => {
                const count = statusCount(s);
                const pct = pages ? (count / pages) * 100 : 0;
                return (
                  <div key={s} className="flex items-center gap-3">
                    <span className="flex w-24 shrink-0 items-center gap-2 text-[13px] font-medium text-text-secondary">
                      <span className={`size-2 rounded-full ${STATUS_DOT[s]}`} />
                      {label(s)}
                    </span>
                    <Bar pct={pct} colorClass={STATUS_DOT[s]} delay={i * 0.07} />
                    <span className="w-7 shrink-0 text-right text-sm font-semibold tabular-nums text-text-primary">
                      {count}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
