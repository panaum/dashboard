import { Skeleton } from "@/components/ui/skeleton";
import { TeamPerformanceView } from "@/components/team/team-performance-view";
import type { Metric, TeamPerformance } from "@/lib/team-performance";
import { cn } from "@/lib/utils";

/**
 * Team performance — per-developer delivery, for whatever set of pages the
 * Insights filters selected.
 *
 * Presentational on purpose: the page runs one query and hands the aggregate
 * down, so this block and the platform/trend blocks below it are always reading
 * the same rows. Rows are keyed by developer id, so a future drill-down to
 * "their pages" is a link to /dashboard/insights?developerId=<id>.
 */
export function TeamPerformancePanel({
  data,
  highlightId,
  developerName,
  scopeNote,
}: {
  data: TeamPerformance;
  /** The developer chosen in the filter bar — highlighted, not isolated. */
  highlightId?: string;
  /** Their name, so the panel can say who it highlighted — or explain their
   *  absence when they delivered nothing in this window. */
  developerName?: string;
  /** How many pages this panel counted, for the honest delay footnote. */
  scopeNote: string;
}) {
  const highlighted = highlightId
    ? data.devs.find((d) => d.id === highlightId)
    : undefined;

  // On-time only leads when there is delay data behind it; see the note the
  // view renders under the chart.
  const defaultMetric: Metric = data.delayRecorded ? "onTime" : "pages";

  return (
    <section className="mb-8" aria-labelledby="team-performance-heading">
      <h2
        id="team-performance-heading"
        className="mb-3 text-sm font-semibold text-text-primary"
      >
        Team performance
      </h2>

      <div className="overflow-hidden rounded-xl border border-border-soft bg-card shadow-xs">
        {highlighted ? (
          <p className="border-b border-border-soft bg-accent/[0.05] px-4 py-2.5 text-[13px] text-text-secondary sm:px-5">
            <span className="font-semibold text-accent">{highlighted.name}</span>{" "}
            is highlighted below — the rest of the team stays in view for
            comparison.
          </p>
        ) : (
          developerName && (
            <p className="border-b border-border-soft bg-card-soft px-4 py-2.5 text-[13px] text-text-secondary sm:px-5">
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
          highlightId={highlightId}
          scopeNote={scopeNote}
          defaultMetric={defaultMetric}
        />
      </div>
    </section>
  );
}

/** Loading placeholder — mirrors the panel's real blocks, so nothing jumps
 *  when the data lands. */
export function TeamPerformanceSkeleton() {
  return (
    <section className="mb-8">
      <Skeleton className="mb-3 h-4 w-36" />
      <div className="overflow-hidden rounded-xl border border-border-soft bg-card shadow-xs">
        <div className="p-5">
          <div className="mb-5 flex items-center justify-between">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-8 w-72 rounded-full" />
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
