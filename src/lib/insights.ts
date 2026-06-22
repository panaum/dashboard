/**
 * Pure analytics for the Insights page — no DB, no React, no I/O.
 *
 * Kept separate from the server component so the aggregation is unit-testable
 * and free of `Date`/timezone math: `deliveryMonth` is a stored "2026-01"
 * string (sorted lexically) and `delayDays` is a stored integer, so the same
 * input always yields the same output.
 */

export type InsightPage = {
  delayDays: number;
  deliveryMonth: string | null;
  developer: { id: string; name: string } | null;
  project: { platform: string };
  issues: { severity: string }[];
};

export type PlatformStat = {
  platform: string;
  pages: number;
  issues: number;
  avg: number;
};

export type DevStat = {
  name: string;
  built: number;
  issues: number;
  rep: number;
  avg: number;
};

export type MonthStat = { m: string; avg: number };

export type Insights = {
  total: number;
  totalIssues: number;
  avgIssues: number;
  repetitive: number;
  onTimePct: number;
  platforms: PlatformStat[];
  maxPlatAvg: number;
  devs: DevStat[];
  months: MonthStat[];
  maxMonthAvg: number;
};

/** Minimum sample size before a platform/developer is ranked, to avoid
 *  one lucky page topping the leaderboard. */
const MIN_SAMPLE = 3;

const isRep = (s: string) => s === "REPETITIVE";

export function computeInsights(pages: InsightPage[]): Insights {
  const total = pages.length;
  const issueCount = (p: InsightPage) => p.issues.length;

  const totalIssues = pages.reduce((n, p) => n + p.issues.length, 0);
  // Guard: empty set → 0, never NaN.
  const avgIssues = total ? totalIssues / total : 0;
  const repetitive = pages.reduce(
    (n, p) => n + p.issues.filter((i) => isRep(i.severity)).length,
    0,
  );
  // delayDays <= 0 means delivered on or ahead of schedule (negative = early).
  const onTimePct = total
    ? Math.round((pages.filter((p) => p.delayDays <= 0).length / total) * 100)
    : 0;

  // By platform.
  const platMap = new Map<string, { pages: number; issues: number }>();
  for (const p of pages) {
    const k = p.project.platform;
    const e = platMap.get(k) ?? { pages: 0, issues: 0 };
    e.pages++;
    e.issues += issueCount(p);
    platMap.set(k, e);
  }
  const platforms = [...platMap.entries()]
    .map(([platform, e]) => ({
      platform,
      ...e,
      avg: e.pages ? e.issues / e.pages : 0,
    }))
    .filter((p) => p.pages >= MIN_SAMPLE)
    .sort((a, b) => b.avg - a.avg);
  const maxPlatAvg = Math.max(1, ...platforms.map((p) => p.avg));

  // By developer.
  const devMap = new Map<
    string,
    { name: string; built: number; issues: number; rep: number }
  >();
  for (const p of pages) {
    if (!p.developer) continue;
    const e = devMap.get(p.developer.id) ?? {
      name: p.developer.name,
      built: 0,
      issues: 0,
      rep: 0,
    };
    e.built++;
    e.issues += issueCount(p);
    e.rep += p.issues.filter((i) => isRep(i.severity)).length;
    devMap.set(p.developer.id, e);
  }
  const devs = [...devMap.values()]
    .filter((d) => d.built >= MIN_SAMPLE)
    .map((d) => ({ ...d, avg: d.built ? d.issues / d.built : 0 }))
    .sort((a, b) => a.avg - b.avg);

  // By delivery month (quality trend). deliveryMonth is a "2026-01" string,
  // so a lexical sort is also chronological — no Date/timezone parsing.
  const monthMap = new Map<string, { pages: number; issues: number }>();
  for (const p of pages) {
    if (!p.deliveryMonth) continue;
    const e = monthMap.get(p.deliveryMonth) ?? { pages: 0, issues: 0 };
    e.pages++;
    e.issues += issueCount(p);
    monthMap.set(p.deliveryMonth, e);
  }
  const months = [...monthMap.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([m, e]) => ({ m, avg: e.pages ? e.issues / e.pages : 0 }));
  const maxMonthAvg = Math.max(1, ...months.map((m) => m.avg));

  return {
    total,
    totalIssues,
    avgIssues,
    repetitive,
    onTimePct,
    platforms,
    maxPlatAvg,
    devs,
    months,
    maxMonthAvg,
  };
}
