"use client";

import { useMemo, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { ArrowDown, ArrowUp } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Select } from "@/components/ui/field";
import { cn } from "@/lib/utils";
import {
  LATE_THRESHOLD,
  metricValue,
  sortForMetric,
  type DevPerf,
  type Metric,
  type TeamPerformance,
} from "@/lib/team-performance";

const METRIC_TABS: { key: Metric; label: string }[] = [
  { key: "onTime", label: "On-time %" },
  { key: "delay", label: "Delay days" },
  { key: "issues", label: "Issues done" },
  { key: "pages", label: "Pages" },
];

const HEADINGS: Record<Metric, string> = {
  onTime: "Lowest on-time rate first",
  delay: "Most delay first",
  issues: "Most issues done first",
  pages: "Most pages first",
};

const days = (n: number) => `${n} day${n === 1 ? "" : "s"}`;

function formatAverage(value: number, m: Metric): string {
  const n = value % 1 === 0 ? String(value) : value.toFixed(1);
  if (m === "onTime") return `${n}%`;
  if (m === "delay") return `${n} day${value === 1 ? "" : "s"}`;
  return n;
}

/** Delay is the one metric where the number itself carries severity, so the
 *  bar colour does the scanning work. Everything else stays a flat accent. */
function barTone(d: DevPerf, m: Metric): string {
  if (m !== "delay") return "bg-accent";
  if (d.delayDays <= 0) return "bg-success";
  if (d.delayDays <= LATE_THRESHOLD) return "bg-warning";
  return "bg-error";
}

/** Name + value on one line with the bar beneath it on narrow screens; a
 *  three-column row once there's width for it. The bar always lands in the
 *  same grid slot, so the team-average line stays aligned in both shapes. */
const CHART_GRID =
  "grid grid-cols-[minmax(0,1fr)_auto] gap-x-2 gap-y-1 sm:grid-cols-[8rem_minmax(0,1fr)_3.5rem] sm:gap-x-3 sm:gap-y-0";
const CHART_TRACK = "col-span-2 sm:col-span-1 sm:col-start-2 sm:row-start-1";

const TABLE_GRID =
  "grid grid-cols-[minmax(0,1fr)_5rem_6rem_6rem_5.5rem] items-center gap-4";

type SortKey = "name" | Metric;

const COLUMNS: { key: SortKey; label: string }[] = [
  { key: "name", label: "Developer" },
  { key: "pages", label: "Pages" },
  { key: "issues", label: "Issues done" },
  { key: "delay", label: "Delay (days)" },
  { key: "onTime", label: "On-time %" },
];

const delayTone = (n: number) =>
  n > LATE_THRESHOLD
    ? "font-medium text-error"
    : n > 0
      ? "font-medium text-warning"
      : "text-text-muted";

export function TeamPerformanceView({
  data,
  highlightId,
  scopeNote,
  defaultMetric,
}: {
  data: TeamPerformance;
  /** The developer chosen in the page filter — highlighted, not isolated. */
  highlightId?: string;
  /** How many pages this panel counted, for the honest delay footnote. */
  scopeNote: string;
  /** On-time %, unless no delay was recorded in scope — then every bar would
   *  be an identical 100% and a metric with real spread opens instead. */
  defaultMetric: Metric;
}) {
  const [metric, setMetric] = useState<Metric>(defaultMetric);
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({
    key: defaultMetric,
    desc: defaultMetric !== "onTime",
  });
  const reduceMotion = useReducedMotion();

  const ranked = useMemo(
    () => sortForMetric(data.devs, metric),
    [data.devs, metric],
  );

  const rows = useMemo(() => {
    const { key, desc } = sort;
    const dir = desc ? -1 : 1;
    return [...data.devs].sort((a, b) =>
      key === "name"
        ? dir * a.name.localeCompare(b.name)
        : dir * (metricValue(a, key) - metricValue(b, key)) ||
          a.name.localeCompare(b.name),
    );
  }, [data.devs, sort]);

  // On-time is a percentage, so it reads against a full 0–100 scale; the count
  // metrics scale to whoever is highest.
  const scaleMax =
    metric === "onTime"
      ? 100
      : Math.max(1, ...ranked.map((d) => metricValue(d, metric)));
  const avg = data.averages[metric];
  const avgPct = Math.min(100, (avg / scaleMax) * 100);

  const toggleSort = (key: SortKey) =>
    setSort((s) =>
      s.key === key
        ? { key, desc: !s.desc }
        : { key, desc: key !== "name" && key !== "onTime" },
    );

  if (data.devs.length === 0) {
    return (
      <div className="border-t border-border-soft px-5 py-12 text-center">
        <p className="text-sm text-text-secondary">
          No results for these filters.
        </p>
        <p className="mt-1.5 text-[13px] text-text-muted">
          Widen the platform or status filter, or pick a different month.
        </p>
      </div>
    );
  }

  return (
    <>
      {/* ── Chart ─────────────────────────────────────────────── */}
      <div className="border-t border-border-soft p-4 sm:p-5">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-sm font-semibold text-text-primary">
            {HEADINGS[metric]}
          </h3>
          <div
            role="tablist"
            aria-label="Chart metric"
            className="flex flex-wrap gap-0.5 rounded-full bg-card-soft p-0.5"
          >
            {METRIC_TABS.map((t) => (
              <button
                key={t.key}
                role="tab"
                aria-selected={metric === t.key}
                onClick={() => setMetric(t.key)}
                className={cn(
                  "rounded-full px-3 py-1.5 text-[12px] font-medium transition-colors",
                  metric === t.key
                    ? "bg-card text-text-primary shadow-xs"
                    : "text-text-secondary hover:text-text-primary",
                )}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* Average marker, placed in the same slot the bars occupy. */}
        <div className={cn(CHART_GRID, "mb-1")}>
          <div className={cn(CHART_TRACK, "relative h-4")}>
            <div
              className="absolute top-0 flex items-center gap-1 whitespace-nowrap text-[11px] font-medium text-text-muted"
              style={{
                left: `${avgPct}%`,
                transform: avgPct > 55 ? "translateX(-100%)" : "none",
              }}
            >
              {avgPct > 55 && (
                <span className="tabular-nums">
                  Team avg {formatAverage(avg, metric)}
                </span>
              )}
              <span aria-hidden className="text-border-soft">
                │
              </span>
              {avgPct <= 55 && (
                <span className="tabular-nums">
                  Team avg {formatAverage(avg, metric)}
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="flex flex-col">
          {ranked.map((d) => {
            const value = metricValue(d, metric);
            const pct = Math.min(100, (value / scaleMax) * 100);
            const isHighlight = d.id === highlightId;
            return (
              <motion.div
                key={d.id}
                layout={!reduceMotion}
                transition={{ type: "spring", stiffness: 240, damping: 28 }}
                className={cn(CHART_GRID, "items-center py-1.5")}
              >
                <div className="flex min-w-0 items-center gap-2 sm:col-start-1 sm:row-start-1">
                  <Avatar
                    name={d.name}
                    size="sm"
                    className="hidden sm:inline-flex"
                  />
                  <span
                    className={cn(
                      "truncate text-[13px]",
                      isHighlight
                        ? "font-semibold text-accent"
                        : "text-text-secondary",
                    )}
                  >
                    {d.name}
                  </span>
                </div>

                <span
                  className={cn(
                    "text-right text-[13px] tabular-nums sm:col-start-3 sm:row-start-1",
                    isHighlight
                      ? "font-semibold text-text-primary"
                      : "text-text-secondary",
                  )}
                >
                  {metric === "onTime"
                    ? `${value}%`
                    : metric === "delay"
                      ? `${value}d`
                      : value}
                </span>

                <div
                  className={cn(
                    CHART_TRACK,
                    "relative h-6 overflow-hidden rounded-md bg-card-soft sm:h-7",
                    isHighlight && "ring-1 ring-accent/50",
                  )}
                >
                  <motion.div
                    className={cn("h-full rounded-md", barTone(d, metric))}
                    initial={reduceMotion ? false : { width: 0 }}
                    animate={{ width: `${pct}%` }}
                    transition={
                      reduceMotion
                        ? { duration: 0 }
                        : { type: "spring", stiffness: 140, damping: 24 }
                    }
                  />
                  {/* Team average, drawn through every bar so the rows read as
                      one continuous line. */}
                  <span
                    aria-hidden
                    className="absolute inset-y-0 w-px bg-text-primary/25"
                    style={{ left: `${avgPct}%` }}
                  />
                </div>
              </motion.div>
            );
          })}
        </div>

        {!data.delayRecorded && (
          <p className="mt-4 text-[13px] text-text-muted">
            Delay is typed in on the page form — it is not derived from dates —
            and none is recorded against {scopeNote}. On-time therefore reads as
            100% for everyone, so the chart opens on a metric that separates.
          </p>
        )}
      </div>

      {/* ── Table: exact numbers ──────────────────────────────── */}
      <div className="border-t border-border-soft">
        {/* Narrow screens: the five columns don't fit, so each developer
            becomes a two-line block and sorting moves into a select. */}
        <div className="flex items-center gap-2 border-b border-border-soft px-4 py-2.5 sm:hidden">
          <label
            htmlFor="team-perf-sort"
            className="text-[11px] font-semibold uppercase tracking-[0.06em] text-text-muted"
          >
            Sort by
          </label>
          <Select
            id="team-perf-sort"
            value={sort.key}
            onChange={(e) =>
              setSort({
                key: e.target.value as SortKey,
                desc: e.target.value !== "name" && e.target.value !== "onTime",
              })
            }
            className="h-8 w-auto flex-1 py-0 text-[13px]"
          >
            {COLUMNS.map((c) => (
              <option key={c.key} value={c.key}>
                {c.label}
              </option>
            ))}
          </Select>
          <button
            onClick={() => setSort((s) => ({ ...s, desc: !s.desc }))}
            aria-label={
              sort.desc ? "Sorted descending" : "Sorted ascending"
            }
            className="rounded-md border border-border-soft p-1.5 text-text-secondary transition-colors hover:text-text-primary"
          >
            {sort.desc ? (
              <ArrowDown className="size-3.5" />
            ) : (
              <ArrowUp className="size-3.5" />
            )}
          </button>
        </div>

        {rows.map((d) => {
          const isHighlight = d.id === highlightId;
          return (
            <div
              key={d.id}
              className={cn(
                "border-t border-border-soft px-4 py-3 transition-colors first:border-t-0 hover:bg-card-soft sm:hidden",
                isHighlight && "bg-accent/[0.05]",
              )}
            >
              <div className="flex items-center gap-2.5">
                <Avatar name={d.name} size="sm" />
                <span
                  className={cn(
                    "min-w-0 flex-1 truncate text-[13px]",
                    isHighlight
                      ? "font-semibold text-accent"
                      : "font-medium text-text-primary",
                  )}
                >
                  {d.name}
                </span>
                <span className="text-[13px] font-medium tabular-nums text-text-primary">
                  {d.onTimePct}% on time
                </span>
              </div>
              <p className="mt-1 pl-[2.25rem] text-[12px] text-text-secondary">
                <span className="tabular-nums">{d.pages}</span>{" "}
                page{d.pages === 1 ? "" : "s"} ·{" "}
                <span className="tabular-nums">{d.issuesDone}</span> issue
                {d.issuesDone === 1 ? "" : "s"} done ·{" "}
                <span className={cn("tabular-nums", delayTone(d.delayDays))}>
                  {days(d.delayDays)}
                </span>{" "}
                late
              </p>
            </div>
          );
        })}

        {/* Wider screens: the real sortable table. */}
        <div
          role="table"
          aria-label="Per-developer performance"
          className="hidden sm:block"
        >
          <div
            role="row"
            className={cn(TABLE_GRID, "border-b border-border-soft px-5 py-2")}
          >
            {COLUMNS.map((c, i) => {
              const active = sort.key === c.key;
              const Arrow = sort.desc ? ArrowDown : ArrowUp;
              return (
                <div
                  key={c.key}
                  role="columnheader"
                  aria-sort={
                    active ? (sort.desc ? "descending" : "ascending") : "none"
                  }
                  className={cn(
                    "flex min-w-0",
                    i === 0 ? "justify-start" : "justify-end",
                  )}
                >
                  <button
                    onClick={() => toggleSort(c.key)}
                    className={cn(
                      "flex items-center gap-1 whitespace-nowrap rounded-xs text-[11px] font-semibold uppercase tracking-[0.06em] transition-colors hover:text-text-primary",
                      active ? "text-text-primary" : "text-text-muted",
                    )}
                  >
                    {c.label}
                    {active && <Arrow className="size-3" />}
                    <span className="sr-only">
                      {`, sort by ${c.label.toLowerCase()}`}
                    </span>
                  </button>
                </div>
              );
            })}
          </div>

          {rows.map((d) => {
            const isHighlight = d.id === highlightId;
            return (
              <div
                key={d.id}
                role="row"
                className={cn(
                  TABLE_GRID,
                  "border-t border-border-soft px-5 py-2.5 transition-colors first:border-t-0 hover:bg-card-soft",
                  isHighlight && "bg-accent/[0.05]",
                )}
              >
                <div role="cell" className="flex min-w-0 items-center gap-2.5">
                  <Avatar name={d.name} size="sm" />
                  <span
                    className={cn(
                      "truncate text-[13px]",
                      isHighlight
                        ? "font-semibold text-accent"
                        : "font-medium text-text-primary",
                    )}
                  >
                    {d.name}
                  </span>
                </div>
                <span
                  role="cell"
                  className="text-right text-[13px] tabular-nums text-text-secondary"
                >
                  {d.pages}
                </span>
                <span
                  role="cell"
                  className="text-right text-[13px] tabular-nums text-text-secondary"
                >
                  {d.issuesDone}
                </span>
                <span
                  role="cell"
                  title={days(d.delayDays)}
                  className={cn(
                    "text-right text-[13px] tabular-nums",
                    delayTone(d.delayDays),
                  )}
                >
                  {d.delayDays}
                </span>
                <span
                  role="cell"
                  className="text-right text-[13px] font-medium tabular-nums text-text-primary"
                >
                  {d.onTimePct}%
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}
