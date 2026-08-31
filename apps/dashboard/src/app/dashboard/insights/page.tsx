import Link from "next/link";
import {
  TrendingUp,
  TrendingDown,
  Award,
  AlertTriangle,
  Download,
} from "lucide-react";
import { db } from "@/lib/db";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/ui/status-badge";
import { Select } from "@/components/ui/field";
import { Button, buttonVariants } from "@/components/ui/button";
import { PageHeader } from "@/components/shared/page-header";
import { OpenSite } from "@/components/shared/open-site";
import { Bar } from "@/components/reports/bar";
import { TeamPerformancePanel } from "@/components/team/team-performance";
import {
  buildPageWhere,
  buildTeamPanelWhere,
  hasAnyFilter,
} from "@/lib/page-search";
import { listPlatforms } from "@/lib/platforms";
import { computeInsights } from "@/lib/insights";
import {
  ROLLING_MONTHS,
  computeTeamPerformance,
  rollingMonths,
  windowLabel,
} from "@/lib/team-performance";
import { cn } from "@/lib/utils";
import { STATUSES, label, monthLabel, type Status } from "@/lib/constants";

export const metadata = { title: "Insights" };

/**
 * Insights — the single analytics surface. It absorbed the old /dashboard/search
 * page: the same filter bar now drives the analysis above and the matching-pages
 * list below, so one set of filters answers both "how is the team doing" and
 * "which pages are these".
 *
 * Scope: with no month chosen, everything on the page reads the last few
 * delivery months rather than all time (see rollingMonths — derived from the
 * stored month strings, not the clock). "All time" is one click away and
 * governs the whole page, so every number here shares one scope.
 */
export default async function InsightsPage({
  searchParams,
}: {
  searchParams: Promise<{
    platform?: string;
    status?: string;
    developerId?: string;
    testerId?: string;
    month?: string;
    /** "all" widens the page past its rolling window. */
    scope?: string;
  }>;
}) {
  const { scope, ...sp } = await searchParams;
  const allTime = scope === "all";

  const [members, monthRows, platformOptions] = await Promise.all([
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
    listPlatforms(),
  ]);
  const months = monthRows.map((m) => m.deliveryMonth!).filter(Boolean);
  const window = rollingMonths(months);
  const inScope = allTime ? null : window;

  // Analysis reads the filtered scope; the team panel reads the same scope with
  // the developer filter dropped, so narrowing to one person highlights them
  // instead of emptying the chart.
  const analysisWhere = {
    ...buildPageWhere(sp),
    ...(sp.month || inScope === null ? {} : { deliveryMonth: { in: inScope } }),
  };

  const hasFilters = hasAnyFilter(sp);

  const [scopedPages, teamPages, results, matchesAllTime] = await Promise.all([
    db.page.findMany({
      where: analysisWhere,
      select: {
        delayDays: true,
        deliveryMonth: true,
        developer: { select: { id: true, name: true } },
        project: { select: { platform: true } },
        issues: { select: { severity: true, status: true } },
      },
    }),
    db.page.findMany({
      where: buildTeamPanelWhere(sp, inScope),
      select: {
        delayDays: true,
        developer: { select: { id: true, name: true } },
        issues: { select: { status: true } },
      },
    }),
    hasFilters
      ? db.page.findMany({
          where: analysisWhere,
          take: 100,
          orderBy: { name: "asc" },
          include: {
            project: { include: { client: true } },
            developer: true,
            tester: true,
            _count: { select: { issues: true } },
          },
        })
      : Promise.resolve([]),
    // How many pages the same filters match with no window at all, so a
    // narrowed scope can say what it is leaving out instead of hiding it.
    hasFilters && !allTime && !sp.month
      ? db.page.count({ where: buildPageWhere(sp) })
      : Promise.resolve(0),
  ]);

  const {
    total,
    avgIssues,
    repetitive,
    onTimePct,
    platforms,
    maxPlatAvg,
    devs,
    months: monthStats,
    maxMonthAvg,
  } = computeInsights(scopedPages);
  const perf = computeTeamPerformance(teamPages);

  const scopeLabel = sp.month
    ? monthLabel(sp.month)
    : allTime
      ? "All time"
      : `Last ${ROLLING_MONTHS} months · ${windowLabel(window, monthLabel)}`;

  // The scope toggle keeps every other filter in the URL; the filter form
  // carries it through as a hidden field so a search doesn't reset it.
  const query = new URLSearchParams(
    Object.entries(sp).filter(([, v]) => v) as [string, string][],
  );
  const exportHref = `/dashboard/insights/export?${new URLSearchParams({
    ...Object.fromEntries(query),
    ...(allTime ? { scope: "all" } : {}),
  }).toString()}`;
  const scopeHref = (() => {
    const q = new URLSearchParams(query);
    if (!allTime) q.set("scope", "all");
    const s = q.toString();
    return `/dashboard/insights${s ? `?${s}` : ""}`;
  })();

  // Auto-flagged callouts (plain-language intelligence)
  const callouts: { icon: typeof Award; tone: string; text: string }[] = [];
  if (platforms.length >= 2) {
    const cleanest = platforms[platforms.length - 1];
    const noisiest = platforms[0];
    callouts.push({
      icon: Award,
      tone: "text-success",
      text: `${label(cleanest.platform)} is your cleanest platform — ${cleanest.avg.toFixed(1)} issues per page.`,
    });
    callouts.push({
      icon: AlertTriangle,
      tone: "text-warning",
      text: `${label(noisiest.platform)} pages average ${noisiest.avg.toFixed(1)} issues — the highest of any platform.`,
    });
  }
  if (devs.length >= 1) {
    const best = devs[0];
    callouts.push({
      icon: Award,
      tone: "text-success",
      text: `${best.name} has the lowest defect rate — ${best.avg.toFixed(1)} issues per page across ${best.built} builds.`,
    });
  }
  if (monthStats.length >= 2) {
    const first = monthStats[0].avg;
    const last = monthStats[monthStats.length - 1].avg;
    const improving = last < first;
    callouts.push({
      icon: improving ? TrendingDown : TrendingUp,
      tone: improving ? "text-success" : "text-error",
      text: improving
        ? `Quality is improving — issues per page fell from ${first.toFixed(1)} to ${last.toFixed(1)} since ${monthLabel(monthStats[0].m)}.`
        : `Issues per page rose from ${first.toFixed(1)} to ${last.toFixed(1)} since ${monthLabel(monthStats[0].m)} — worth a look.`,
    });
  }

  // Developers = DEVELOPER/BOTH; testers = pure TESTER only.
  const developers = members.filter((m) => m.role !== "TESTER");
  const testers = members.filter((m) => m.role === "TESTER");
  const fieldCls = "w-auto text-[13px]";

  const tiles = [
    { label: "Pages", value: `${total}`, note: undefined as string | undefined },
    { label: "Avg issues / page", value: avgIssues.toFixed(1), note: undefined },
    {
      label: "On-time delivery",
      value: `${onTimePct}%`,
      note: perf.delayRecorded ? undefined : "No delay recorded",
    },
    { label: "Repetitive bugs", value: `${repetitive}`, note: undefined },
  ];

  return (
    <>
      <PageHeader
        title="Insights"
        subtitle="Quality and delivery across the team — filter to narrow every number on this page."
      />

      <form method="get" className="mb-3 flex flex-wrap items-end gap-2">
        {allTime && <input type="hidden" name="scope" value="all" />}
        <Select name="platform" defaultValue={sp.platform ?? ""} className={`${fieldCls} w-auto`}>
          <option value="">Any platform</option>
          {platformOptions.map((p) => (
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
        <Button type="submit" size="sm">Apply</Button>
        {hasFilters && (
          <Link
            href={allTime ? "/dashboard/insights?scope=all" : "/dashboard/insights"}
            className="px-2 py-2 text-[13px] text-text-secondary hover:text-text-primary"
          >
            Clear
          </Link>
        )}
      </form>

      <p className="mb-6 text-[13px] text-text-secondary">
        {scopeLabel}
        {!sp.month && (
          <>
            {" · "}
            <Link
              href={scopeHref}
              className="rounded-xs font-medium text-accent hover:underline"
            >
              {allTime ? `Last ${ROLLING_MONTHS} months` : "All time"}
            </Link>
          </>
        )}
      </p>

      {total === 0 ? (
        <div className="rounded-xl border border-border-soft bg-card px-4 py-16 text-center">
          <p className="text-sm text-text-secondary">
            No results for these filters.
          </p>
          <p className="mt-1.5 text-[13px] text-text-muted">
            Widen the platform or status filter, or pick a different month.
          </p>
        </div>
      ) : (
        <>
          {/* Auto-flagged intelligence */}
          {callouts.length > 0 && (
            <div className="mb-8 grid gap-3 sm:grid-cols-2">
              {callouts.map((c, i) => (
                <div
                  key={i}
                  className="flex items-start gap-3 rounded-xl border border-border-soft bg-card p-4"
                >
                  <span className={`mt-0.5 ${c.tone}`}>
                    <c.icon className="size-5" />
                  </span>
                  <p className="text-sm text-text-primary">{c.text}</p>
                </div>
              ))}
            </div>
          )}

          {/* Headline numbers */}
          <div
            role="group"
            aria-label="Headline numbers"
            className="mb-9 grid grid-cols-2 divide-x divide-border-soft overflow-hidden rounded-xl border border-border-soft bg-card md:grid-cols-4"
          >
            {tiles.map((s) => (
              <div key={s.label} className="px-4 py-4 sm:px-5">
                <div className="text-[10px] font-semibold uppercase tracking-[0.06em] text-text-muted sm:text-[11px] sm:tracking-[0.08em]">
                  {s.label}
                </div>
                <div className="mt-2 text-[24px] font-semibold leading-none tracking-tight tabular-nums text-text-primary sm:text-[28px]">
                  {s.value}
                </div>
                {s.note && (
                  <div className="mt-1.5 text-[11px] text-text-muted">
                    {s.note}
                  </div>
                )}
              </div>
            ))}
          </div>

          <TeamPerformancePanel
            data={perf}
            highlightId={sp.developerId}
            developerName={members.find((m) => m.id === sp.developerId)?.name}
            scopeNote={`${perf.totals.pages} page${perf.totals.pages === 1 ? "" : "s"}`}
          />

          <div className="grid gap-6 lg:grid-cols-2">
            {/* Platform quality */}
            <div className="rounded-xl border border-border-soft bg-card p-5">
              <h2 className="mb-1 text-sm font-semibold text-text-primary">
                Quality by platform
              </h2>
              <p className="mb-4 text-[13px] text-text-secondary">
                Average issues per page — lower is better.
              </p>
              {platforms.length === 0 ? (
                <p className="py-6 text-[13px] text-text-muted">
                  No platform has 3 or more pages in this scope.
                </p>
              ) : (
                <div className="flex flex-col gap-3">
                  {platforms.map((p, i) => (
                    <div key={p.platform} className="flex items-center gap-3">
                      <span className="w-28 shrink-0 truncate text-[13px] text-text-secondary">
                        {label(p.platform)}
                      </span>
                      <Bar
                        pct={(p.avg / maxPlatAvg) * 100}
                        colorClass={i === platforms.length - 1 ? "bg-success" : "bg-accent"}
                        delay={i * 0.05}
                      />
                      <span className="w-10 shrink-0 text-right text-sm font-semibold tabular-nums text-text-primary">
                        {p.avg.toFixed(1)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Monthly quality trend */}
            <div className="rounded-xl border border-border-soft bg-card p-5">
              <h2 className="mb-1 text-sm font-semibold text-text-primary">
                Quality trend
              </h2>
              <p className="mb-4 text-[13px] text-text-secondary">
                Average issues per page, by delivery month.
              </p>
              <div className="flex items-end gap-3" style={{ height: 130 }}>
                {monthStats.map((m) => {
                  const h = Math.max(6, Math.round((m.avg / maxMonthAvg) * 96));
                  return (
                    <div
                      key={m.m}
                      className="flex flex-1 flex-col items-center justify-end gap-1.5"
                      title={`${m.avg.toFixed(1)} issues/page`}
                    >
                      <span className="text-[11px] font-semibold tabular-nums text-text-primary">
                        {m.avg.toFixed(1)}
                      </span>
                      <div
                        className="w-full max-w-[40px] rounded-t-md bg-accent"
                        style={{ height: h }}
                      />
                      <span className="text-[11px] text-text-muted">
                        {monthLabel(m.m).slice(0, 3)}
                      </span>
                    </div>
                  );
                })}
              </div>
              {!allTime && !sp.month && months.length > window.length && (
                <p className="mt-4 text-[13px] text-text-muted">
                  Showing the months in scope. Switch to all time for the full
                  trend.
                </p>
              )}
            </div>
          </div>
        </>
      )}

      {/* Matching pages — the drill-down for whatever the filters selected */}
      {hasFilters && (
        <section className="mt-8" aria-labelledby="matching-pages-heading">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2
              id="matching-pages-heading"
              className="text-sm font-semibold text-text-primary"
            >
              Matching pages
              <span className="ml-2 font-normal text-text-secondary">
                {results.length} result{results.length === 1 ? "" : "s"}
                {results.length === 100 ? " (showing first 100)" : ""}
              </span>
            </h2>
            {results.length > 0 && (
              <a
                href={exportHref}
                className={cn(buttonVariants({ variant: "secondary", size: "sm" }))}
              >
                <Download /> Export CSV
              </a>
            )}
          </div>

          {matchesAllTime > results.length && (
            <p className="mb-3 text-[13px] text-text-muted">
              {matchesAllTime} page{matchesAllTime === 1 ? "" : "s"} match these
              filters across all time.{" "}
              <Link
                href={scopeHref}
                className="rounded-xs font-medium text-accent hover:underline"
              >
                Show all time
              </Link>
            </p>
          )}

          {results.length === 0 ? (
            <div className="rounded-xl border border-border-soft bg-card px-4 py-12 text-center text-sm text-text-secondary">
              No matches in this window. Try fewer filters, or widen the scope
              to all time.
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
        </section>
      )}

      {!hasFilters && (
        <p className="mt-8 flex flex-wrap items-center justify-center gap-1.5 py-2 text-[13px] text-text-muted">
          Filter above to list the matching pages, or press
          <kbd className="rounded-md border border-border-soft bg-card-soft px-1.5 py-0.5 text-[11px] font-medium text-text-secondary">
            ⌘K
          </kbd>
          to jump to one by name.
        </p>
      )}
    </>
  );
}
