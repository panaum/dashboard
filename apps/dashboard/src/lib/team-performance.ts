/**
 * Per-developer delivery performance — pure, no DB, no React, no `Date`.
 *
 * Same discipline as insights.ts / attention.ts: every number comes from stored
 * fields (`delayDays` integer, `deliveryMonth` "2026-01" string, issue status),
 * so the same input always yields the same output and it's unit-testable
 * without a clock or a database.
 *
 * The on-time rule is deliberately the one already used by the Insights page
 * (`delayDays <= 0` counts as on time, negative = early) — one delay definition
 * in the app, not two.
 */

export const METRICS = [
  "onTime",
  "delay",
  "issues",
  "defects",
  "pages",
] as const;
export type Metric = (typeof METRICS)[number];

/** Days late before the delay bar turns from amber to red. Matches the
 *  "needs attention" threshold in attention.ts so the two agree. */
export const LATE_THRESHOLD = 5;

/** Below this many pages a defect rate is one bad day, not a pattern. The
 *  Insights leaderboard used the same floor to decide who to rank; here nobody
 *  is hidden, the thin samples are named under the chart instead. */
export const MIN_SAMPLE = 3;

/** How many delivery months the panel shows by default. `deliveryMonth` is
 *  month-granular, so a rolling window can only be counted in months — three
 *  of them is the closest honest reading of "the last quarter or so". */
export const ROLLING_MONTHS = 3;

export type TeamPerfPage = {
  delayDays: number;
  developer: { id: string; name: string } | null;
  issues: { status: string }[];
};

export type DevPerf = {
  id: string;
  name: string;
  /** Pages built. Developers are assigned per Page, so this is the app's
   *  "built" count — the deliverable unit everywhere else in the dashboard. */
  pages: number;
  issuesDone: number;
  /** Every issue logged against their pages, fixed or still open. */
  issuesTotal: number;
  /** Issues per page — the defect rate the Insights leaderboard ranked on.
   *  Lower is better, and it is the one metric here where more work does not
   *  mean a bigger number. */
  issuesPerPage: number;
  delayDays: number;
  /** 0–100, rounded. Share of this developer's pages with delayDays <= 0. */
  onTimePct: number;
};

export type TeamPerformance = {
  devs: DevPerf[];
  totals: {
    developers: number;
    pages: number;
    issuesDone: number;
    delayDays: number;
    /** Org-wide on-time share across every page in scope. */
    onTimePct: number;
  };
  /** Mean of the plotted developer values, per metric — this is what the
   *  reference line on the chart draws, so it matches the bars exactly. */
  averages: Record<Metric, number>;
  /** False when no page in scope carries a delay > 0, i.e. the delay column
   *  simply hasn't been filled in. The UI says so rather than implying a
   *  flawless record. */
  delayRecorded: boolean;
};

const EMPTY_TOTALS = {
  developers: 0,
  pages: 0,
  issuesDone: 0,
  delayDays: 0,
  onTimePct: 0,
};

const mean = (values: number[]) =>
  values.length ? values.reduce((s, v) => s + v, 0) / values.length : 0;

export function computeTeamPerformance(
  pages: TeamPerfPage[],
): TeamPerformance {
  const map = new Map<
    string,
    {
      name: string;
      pages: number;
      issuesDone: number;
      issuesTotal: number;
      delayDays: number;
      onTime: number;
    }
  >();

  for (const p of pages) {
    if (!p.developer) continue; // unassigned pages count for nobody
    const e = map.get(p.developer.id) ?? {
      name: p.developer.name,
      pages: 0,
      issuesDone: 0,
      issuesTotal: 0,
      delayDays: 0,
      onTime: 0,
    };
    e.pages++;
    e.issuesDone += p.issues.filter((i) => i.status === "FIXED").length;
    e.issuesTotal += p.issues.length;
    e.delayDays += p.delayDays;
    if (p.delayDays <= 0) e.onTime++;
    map.set(p.developer.id, e);
  }

  const devs: DevPerf[] = [...map.entries()]
    .map(([id, e]) => ({
      id,
      name: e.name,
      pages: e.pages,
      issuesDone: e.issuesDone,
      issuesTotal: e.issuesTotal,
      issuesPerPage: e.pages ? e.issuesTotal / e.pages : 0,
      delayDays: e.delayDays,
      onTimePct: e.pages ? Math.round((e.onTime / e.pages) * 100) : 0,
    }))
    .sort((a, b) => b.pages - a.pages || a.name.localeCompare(b.name));

  const assigned = devs.reduce((s, d) => s + d.pages, 0);
  const onTimePages = pages.filter(
    (p) => p.developer && p.delayDays <= 0,
  ).length;

  return {
    devs,
    totals: devs.length
      ? {
          developers: devs.length,
          pages: assigned,
          issuesDone: devs.reduce((s, d) => s + d.issuesDone, 0),
          delayDays: devs.reduce((s, d) => s + d.delayDays, 0),
          onTimePct: assigned
            ? Math.round((onTimePages / assigned) * 100)
            : 0,
        }
      : EMPTY_TOTALS,
    averages: {
      onTime: mean(devs.map((d) => d.onTimePct)),
      delay: mean(devs.map((d) => d.delayDays)),
      issues: mean(devs.map((d) => d.issuesDone)),
      defects: mean(devs.map((d) => d.issuesPerPage)),
      pages: mean(devs.map((d) => d.pages)),
    },
    delayRecorded: pages.some((p) => p.delayDays > 0),
  };
}

/** Developers whose defect rate rests on too few pages to mean much. Named
 *  under the chart rather than filtered out of it. */
export function thinSamples(devs: DevPerf[]): DevPerf[] {
  return devs.filter((d) => d.pages < MIN_SAMPLE);
}

/** The value a given metric plots for a developer. */
export function metricValue(d: DevPerf, m: Metric): number {
  switch (m) {
    case "onTime":
      return d.onTimePct;
    case "delay":
      return d.delayDays;
    case "issues":
      return d.issuesDone;
    case "defects":
      return d.issuesPerPage;
    case "pages":
      return d.pages;
  }
}

/** Worst-first for the metrics where "worst" is meaningful (lowest on-time
 *  rate, highest delay, highest defect rate); busiest-first for the volume
 *  metrics. */
export function sortForMetric(devs: DevPerf[], m: Metric): DevPerf[] {
  const dir = m === "onTime" ? 1 : -1;
  return [...devs].sort(
    (a, b) => dir * (metricValue(a, m) - metricValue(b, m)) || a.name.localeCompare(b.name),
  );
}

/**
 * The default rolling window: the most recent `count` delivery months that
 * actually exist in the data. Derived from stored month strings rather than
 * from the clock, so it stays deterministic — and it never lands on an empty
 * window just because the calendar has moved past the last delivery.
 *
 * `months` may be in any order; the newest `count` are returned, oldest first.
 */
export function rollingMonths(
  months: string[],
  count: number = ROLLING_MONTHS,
): string[] {
  return [...new Set(months)]
    .sort((a, b) => b.localeCompare(a))
    .slice(0, count)
    .reverse();
}

/** "Jun–Aug 2026" / "Aug 2026" — the human label for a month window. */
export function windowLabel(
  months: string[],
  monthName: (ym: string) => string,
): string {
  if (months.length === 0) return "No delivery months";
  if (months.length === 1) return monthName(months[0]);
  const first = monthName(months[0]);
  const last = monthName(months[months.length - 1]);
  const [fMon, fYear] = first.split(" ");
  const [lMon, lYear] = last.split(" ");
  return fYear === lYear ? `${fMon}–${lMon} ${lYear}` : `${first} – ${last}`;
}
