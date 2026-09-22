import Link from "next/link";
import type { CSSProperties } from "react";
import {
  TrendingUp,
  TrendingDown,
  Award,
  AlertTriangle,
  Download,
} from "lucide-react";
import { db } from "@/lib/db";
import { Select } from "@/components/ui/field";
import { Button, buttonVariants } from "@/components/ui/button";
import { PageHeader } from "@/components/shared/page-header";
import { AnimatedNumber } from "@/components/shared/animated-number";
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
import { STATUSES, label, monthLabel } from "@/lib/constants";
import { buildsPages, testsPages } from "@/lib/roles";

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

  const [scopedPages, teamPages, matchCount] = await Promise.all([
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
    // Only how MANY pages match, for the export button. This used to pull the
    // first 100 rows with their project, client, developer and tester joined,
    // to render a list that repeated what the numbers above already said.
    hasFilters ? db.page.count({ where: analysisWhere }) : Promise.resolve(0),
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
  // The mean of the months on screen, for the baseline drawn across the trend.
  const meanMonthAvg = monthStats.length
    ? monthStats.reduce((n, m) => n + m.avg, 0) / monthStats.length
    : 0;

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
  // Whitelists, not `!== "TESTER"`: that form put the CEO in the developer
  // picker the day MANAGER was added. See src/lib/roles.ts.
  const developers = members.filter((m) => buildsPages(m.role));
  const testers = members.filter((m) => testsPages(m.role));
  const fieldCls = "w-auto text-[13px]";

  // Numbers rather than pre-formatted strings, so they can count up. `tone`
  // is semantic only — it fires when a number is worth noticing, never for
  // decoration.
  const tiles: {
    label: string;
    value: number;
    decimals?: number;
    suffix?: string;
    note?: string;
    tone?: "warning" | "success";
  }[] = [
    { label: "Pages", value: total },
    { label: "Avg issues / page", value: avgIssues, decimals: 1 },
    {
      label: "On-time delivery",
      value: onTimePct,
      suffix: "%",
      note: perf.delayRecorded ? undefined : "No delay recorded",
      tone: !perf.delayRecorded ? undefined : onTimePct >= 95 ? "success" : onTimePct < 85 ? "warning" : undefined,
    },
    { label: "Repetitive bugs", value: repetitive, tone: repetitive > 0 ? "warning" : undefined },
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
        {/* The export belongs with the filters that decide what it contains.
            It used to sit at the bottom, attached to a list of matching pages
            that repeated what the numbers above already said — the list is
            gone, the export is not. */}
        {matchCount > 0 && (
          <a
            href={exportHref}
            className={cn(buttonVariants({ variant: "secondary", size: "sm" }), "ml-auto")}
          >
            <Download /> Export CSV
            <span className="text-text-muted">
              {/* The route caps a download at 1000 rows; say so rather than
                  hand somebody a silently truncated file. */}
              ({Math.min(matchCount, 1000)}
              {matchCount > 1000 ? " of " + matchCount : ""})
            </span>
          </a>
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
              {callouts.map((c, i) => {
                // Good news and bad news were the same grey card with a
                // differently coloured icon. The wash and the icon chip make
                // which is which readable before the sentence is.
                const good = c.tone === "text-success";
                return (
                  <div
                    key={i}
                    style={{ animationDelay: `${i * 70}ms` }}
                    className={cn(
                      "animate-in flex items-start gap-3 rounded-xl border p-4",
                      good
                        ? "border-success/25 bg-success/[0.07]"
                        : "border-warning/30 bg-warning/[0.07]",
                    )}
                  >
                    <span
                      className={cn(
                        "flex size-8 shrink-0 items-center justify-center rounded-full",
                        good ? "bg-success/15 text-success-strong" : "bg-warning/15 text-warning-strong",
                      )}
                    >
                      <c.icon className="size-4" />
                    </span>
                    <p className="text-sm text-text-primary">{c.text}</p>
                  </div>
                );
              })}
            </div>
          )}

          {/* Headline numbers */}
          {/* Four cards that arrive in sequence and count up, matching the
              Team page. They were one flat divided strip of static text on a
              page where everything else moved. */}
          <div
            role="group"
            aria-label="Headline numbers"
            className="mb-9 grid grid-cols-2 gap-3 md:grid-cols-4"
          >
            {tiles.map((t, i) => (
              <div
                key={t.label}
                style={{ animationDelay: `${i * 60}ms` }}
                className="animate-in rounded-xl border border-border-soft bg-card px-4 py-4 transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-sm sm:px-5"
              >
                <div className="text-[10px] font-semibold uppercase tracking-[0.06em] text-text-muted sm:text-[11px] sm:tracking-[0.08em]">
                  {t.label}
                </div>
                <div
                  className={cn(
                    "mt-2 text-[24px] font-semibold leading-none tracking-tight tabular-nums sm:text-[28px]",
                    t.tone === "warning" && "text-warning-strong",
                    t.tone === "success" && "text-success-strong",
                    !t.tone && "text-text-primary",
                  )}
                >
                  <AnimatedNumber value={t.value} decimals={t.decimals ?? 0} />
                  {t.suffix}
                </div>
                {t.note && (
                  <div className="mt-1.5 text-[11px] text-text-muted">{t.note}</div>
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
              {/* A dashed mean across the columns: without it a reader has to
                  hold six numbers in their head to see whether a month was
                  above or below the usual. */}
              <div className="relative flex items-end gap-3" style={{ height: 130 }}>
                {monthStats.length > 1 && (
                  <div
                    aria-hidden
                    className="pointer-events-none absolute inset-x-0 border-t border-dashed border-border-strong/70"
                    style={{ bottom: 22 + Math.round((meanMonthAvg / maxMonthAvg) * 96) }}
                  >
                    <span className="absolute -top-2 right-0 bg-card pl-1.5 text-[10px] font-medium text-text-muted">
                      avg {meanMonthAvg.toFixed(1)}
                    </span>
                  </div>
                )}
                {monthStats.map((m, i) => {
                  const h = Math.max(6, Math.round((m.avg / maxMonthAvg) * 96));
                  return (
                    <div
                      key={m.m}
                      className="group/bar relative flex flex-1 flex-col items-center justify-end gap-1.5"
                      title={`${m.avg.toFixed(1)} issues/page`}
                    >
                      <span className="text-[11px] font-semibold tabular-nums text-text-primary">
                        {m.avg.toFixed(1)}
                      </span>
                      <div
                        className="animate-grow w-full max-w-[40px] rounded-t-md bg-accent transition-colors group-hover/bar:bg-accent-bright"
                        style={{ "--bar-h": `${h}px`, animationDelay: `${i * 60}ms` } as CSSProperties}
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

    </>
  );
}
