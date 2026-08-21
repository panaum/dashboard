import Link from "next/link";
import { db } from "@/lib/db";
import { Skeleton } from "@/components/ui/skeleton";
import { TeamPerformanceView } from "@/components/team/team-performance-view";
import { buildTeamPanelWhere, type PageSearchParams } from "@/lib/page-search";
import {
  ROLLING_MONTHS,
  computeTeamPerformance,
  rollingMonths,
  windowLabel,
} from "@/lib/team-performance";
import { monthLabel } from "@/lib/constants";
import { cn } from "@/lib/utils";

/**
 * Team performance — per-developer delivery, driven by the same filters as the
 * search below it. Aggregation happens here on the server (one grouped read,
 * then a pure reducer); the client only receives one row per developer.
 *
 * The row shape returned by `computeTeamPerformance` is keyed by developer id,
 * so a future drill-down to "their pages" is a link to
 * /dashboard/search?developerId=<id> — no refetch shape change needed.
 */
export async function TeamPerformancePanel({
  sp,
  allTime,
  months,
  developerName,
}: {
  sp: PageSearchParams;
  /** All-time scope, opted into from the panel header. */
  allTime: boolean;
  /** Every delivery month present in the data, newest first. */
  months: string[];
  /** Name behind `sp.developerId`, so the panel can say who it highlighted —
   *  or explain their absence when they delivered nothing in this window. */
  developerName?: string;
}) {
  const window = rollingMonths(months);
  const pages = await db.page.findMany({
    where: buildTeamPanelWhere(sp, allTime ? null : window),
    select: {
      delayDays: true,
      developer: { select: { id: true, name: true } },
      issues: { select: { status: true } },
    },
  });

  const data = computeTeamPerformance(pages);
  const highlighted = sp.developerId
    ? data.devs.find((d) => d.id === sp.developerId)
    : undefined;

  const scope = sp.month
    ? monthLabel(sp.month)
    : allTime
      ? "All time"
      : `Last ${ROLLING_MONTHS} months · ${windowLabel(window, monthLabel)}`;

  const scopeNote = `${data.totals.pages} page${data.totals.pages === 1 ? "" : "s"}`;

  // The scope toggle keeps every other filter in the URL, and the search form
  // carries it through as a hidden field so a search doesn't reset it.
  const toggleHref = (() => {
    const q = new URLSearchParams(
      Object.entries(sp).filter(([, v]) => v) as [string, string][],
    );
    if (allTime) q.delete("scope");
    else q.set("scope", "all");
    const s = q.toString();
    return `/dashboard/search${s ? `?${s}` : ""}`;
  })();

  // On-time leads when there is delay data behind it. When the delay column is
  // empty it is a 100% that means "nobody typed a number", so it moves to the
  // end and says so rather than posing as the headline.
  const onTimeStat = {
    label: "On-time delivery",
    value: `${data.totals.onTimePct}%`,
    note: data.delayRecorded ? undefined : "No delay recorded",
  };
  const volumeStats = [
    { label: "Pages delivered", value: `${data.totals.pages}`, note: undefined },
    { label: "Issues fixed", value: `${data.totals.issuesDone}`, note: undefined },
  ];
  const stats = data.delayRecorded
    ? [onTimeStat, ...volumeStats]
    : [...volumeStats, onTimeStat];

  return (
    <section className="mb-8" aria-labelledby="team-performance-heading">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2
          id="team-performance-heading"
          className="text-sm font-semibold text-text-primary"
        >
          Team performance
        </h2>
        <p className="text-[13px] text-text-secondary">
          {scope}
          {!sp.month && (
            <>
              {" · "}
              <Link
                href={toggleHref}
                className="rounded-xs font-medium text-accent hover:underline"
              >
                {allTime ? `Last ${ROLLING_MONTHS} months` : "All time"}
              </Link>
            </>
          )}
        </p>
      </div>

      <div className="overflow-hidden rounded-xl border border-border-soft bg-card shadow-xs">
        <div className="grid grid-cols-3 divide-x divide-border-soft">
          {stats.map((s) => (
            <div key={s.label} className="px-3 py-3.5 sm:px-5 sm:py-4">
              <div className="text-[10px] font-semibold uppercase tracking-[0.06em] text-text-muted sm:text-[11px] sm:tracking-[0.08em]">
                {s.label}
              </div>
              <div className="mt-2 text-[22px] font-semibold leading-none tracking-tight tabular-nums text-text-primary sm:text-[28px]">
                {s.value}
              </div>
              {s.note && (
                <div className="mt-1.5 text-[11px] text-text-muted">{s.note}</div>
              )}
            </div>
          ))}
        </div>

        {highlighted ? (
          <p className="border-t border-border-soft bg-accent/[0.05] px-4 py-2.5 text-[13px] text-text-secondary sm:px-5">
            <span className="font-semibold text-accent">{highlighted.name}</span>{" "}
            is highlighted below — the rest of the team stays in view for
            comparison.
          </p>
        ) : (
          developerName && (
            <p className="border-t border-border-soft bg-card-soft px-4 py-2.5 text-[13px] text-text-secondary sm:px-5">
              <span className="font-medium text-text-primary">
                {developerName}
              </span>{" "}
              delivered nothing in this window, so there is no bar to highlight.
              The rest of the team is below.
            </p>
          )
        )}

        <TeamPerformanceView
          data={data}
          highlightId={sp.developerId}
          scopeNote={scopeNote}
          defaultMetric={data.delayRecorded ? "onTime" : "pages"}
        />
      </div>
    </section>
  );
}

/** Streaming placeholder — mirrors the panel's real blocks, so nothing jumps
 *  when the data lands. */
export function TeamPerformanceSkeleton() {
  return (
    <section className="mb-8">
      <div className="mb-3 flex items-baseline justify-between gap-4">
        <Skeleton className="h-4 w-36" />
        <Skeleton className="h-4 w-52" />
      </div>
      <div className="overflow-hidden rounded-xl border border-border-soft bg-card shadow-xs">
        <div className="grid grid-cols-3 divide-x divide-border-soft">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="px-4 py-4 sm:px-5">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="mt-2.5 h-7 w-16" />
            </div>
          ))}
        </div>
        <div className="border-t border-border-soft p-5">
          <div className="mb-5 flex items-center justify-between">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-8 w-64 rounded-full" />
          </div>
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className={cn(
                "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 gap-y-1 py-1.5",
                "sm:grid-cols-[8rem_minmax(0,1fr)_3.5rem] sm:gap-x-3 sm:gap-y-0",
              )}
            >
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-4 w-8 justify-self-end sm:col-start-3" />
              <Skeleton className="col-span-2 h-6 sm:col-span-1 sm:col-start-2 sm:row-start-1 sm:h-7" />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
