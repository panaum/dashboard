import type { Severity } from "./constants";

// THE METRIC LAYER — pure functions over plain rows, no Prisma, no clock.
//
// Two rules are enforced by the shape of the input type rather than by
// discipline, because discipline is how the old numbers went wrong:
//
// 1. `Issue.status` IS NOT IN `IssueRow`. In this database status does not
//    describe a lifecycle — it describes which import epoch a row came from.
//    Every issue delivered Jan–Jun is FIXED (all 1693 written on one day, none
//    ever updated since); every issue delivered Jul onwards is OPEN. Nobody
//    marks issues fixed in the product and nobody intends to. A metric that
//    filters on status is measuring the calendar, so the field is not
//    available here to filter on.
//
// 2. Nothing in this file reads issue TITLE or DESCRIPTION. 99.8% of titles
//    are placeholders ("Issue 9", "Laurier Dental Spa — issue 10") and every
//    description is empty, so text-derived signatures, issue types and
//    coverage gaps are blocked at capture. `blocked()` exists to say so out
//    loud rather than return a zero that reads like an answer.

// ─── configuration ──────────────────────────────────────────────────────────

/** Below this, a cell is never ranked. Joint-best on one page is not a
 *  display bug, it is a correctness bug. */
export const MIN_N = 5;

/** A tester needs this many reviewed pages before their rate is allowed to
 *  adjust anybody else's number. */
export const MIN_TESTER_PAGES = 5;

/** Fewer usable testers than this and the adjustment is a two-point correction
 *  factor rather than a control, so it never claims high confidence. */
export const MIN_TESTERS_FOR_CONFIDENCE = 3;

/**
 * What one defect is worth. A broken form and a 4px padding error stop being
 * one unit here — but see the memo: severity is currently 98.7% LOW with zero
 * CRITICAL_HIGH recorded, so today this weighting is very nearly the identity
 * function. It is built because the field exists and the weights belong in one
 * place; it becomes useful the day severity is actually used.
 *
 * REPETITIVE is a severity value in this schema, which conflates "how bad" with
 * "again" — it is weighted as a minor defect here and counted as recurrence by
 * `isRecurring`, which is the dimension it actually carries.
 */
export const SEVERITY_WEIGHT: Record<Severity, number> = {
  CRITICAL_HIGH: 8,
  MEDIUM: 3,
  LOW: 1,
  REPETITIVE: 1,
};

// ─── shapes ─────────────────────────────────────────────────────────────────

export type Confidence = "high" | "low" | "insufficient" | "blocked";

/** Months are the only time axis this data has: `deliveryMonth` is "2026-07",
 *  and no page carries a brief, build-start or QA-start timestamp. */
export type Period = { months: string[]; label: string };

export type Metric<T = number> = {
  value: T | null;
  n: number;
  confidence: Confidence;
  period: Period;
  previousPeriodValue: T | null;
  /** Present when confidence is "blocked" or "insufficient": why, in a
   *  sentence the UI can render instead of a number. */
  note?: string;
};

export type Cell<T = number> = Metric<T> & { key: string };

export type IssueRow = {
  severity: string;
  /** The correct recurrence field. Defaulted false on every historical row;
   *  see isRecurring for how the legacy severity value is bridged. */
  recurring: boolean;
};

export type PageRow = {
  id: string;
  deliveryMonth: string | null;
  developerId: string | null;
  testerId: string | null;
  platform: string;
  clientId: string;
  issues: IssueRow[];
};

// ─── period helpers ─────────────────────────────────────────────────────────

/** "2026-07" → the month `back` months earlier, without touching a Date. */
function shiftMonth(month: string, back: number): string {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  const total = y * 12 + (m - 1) - back;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}`;
}

export function makePeriod(months: string[], label?: string): Period {
  const sorted = [...new Set(months)].sort();
  return {
    months: sorted,
    label: label ?? (sorted.length ? `${sorted[0]} – ${sorted[sorted.length - 1]}` : "no months"),
  };
}

/** The equally long run of months immediately before this one. Derived from
 *  the period's own span, so a 9-month view compares against the 9 before it. */
export function previousPeriod(period: Period): Period {
  const n = period.months.length;
  if (n === 0) return makePeriod([]);
  const first = period.months[0];
  return makePeriod(
    Array.from({ length: n }, (_, i) => shiftMonth(first, n - i)),
    "previous period",
  );
}

const within = (p: PageRow, period: Period) =>
  p.deliveryMonth !== null && period.months.includes(p.deliveryMonth);

export const inPeriod = (pages: PageRow[], period: Period) =>
  pages.filter((p) => within(p, period));

// ─── primitives ─────────────────────────────────────────────────────────────

/**
 * Recurrence, reading both fields on purpose.
 *
 * `recurring` is the right one and is false on all 2322 rows because only the
 * boards UI can set it and boards is days old. The 25 rows carrying the legacy
 * REPETITIVE severity are the only repeat signal this database has ever held,
 * and the import they came from is trusted history, so they count. New rows
 * will arrive through `recurring` and this bridge costs nothing.
 */
export const isRecurring = (i: IssueRow) => i.recurring || i.severity === "REPETITIVE";

export const weightOf = (i: IssueRow) =>
  SEVERITY_WEIGHT[i.severity as Severity] ?? SEVERITY_WEIGHT.LOW;

const sum = (ns: number[]) => ns.reduce((a, b) => a + b, 0);
const round = (n: number, dp = 2) => Math.round(n * 10 ** dp) / 10 ** dp;

function confidenceFor(n: number, cap: Confidence = "high"): Confidence {
  if (n < MIN_N) return "insufficient";
  return cap;
}

/** A metric that cannot be computed because the field it needs does not
 *  exist. It renders as an explicit gap; it never renders as zero. */
export function blocked(period: Period, note: string): Metric {
  return { value: null, n: 0, confidence: "blocked", period, previousPeriodValue: null, note };
}

// ─── defect rate ────────────────────────────────────────────────────────────

const rateOf = (pages: PageRow[]) =>
  pages.length === 0 ? null : round(sum(pages.map((p) => p.issues.length)) / pages.length);

const weightedRateOf = (pages: PageRow[]) =>
  pages.length === 0 ? null : round(sum(pages.map((p) => sum(p.issues.map(weightOf)))) / pages.length);

/** Issues per delivered page, over the whole period. */
export function defectRate(pages: PageRow[], period: Period): Metric {
  const now = inPeriod(pages, period);
  return {
    value: rateOf(now),
    n: now.length,
    confidence: confidenceFor(now.length),
    period,
    previousPeriodValue: rateOf(inPeriod(pages, previousPeriod(period))),
  };
}

/** The same number with each defect weighted by severity. */
export function weightedDefectRate(pages: PageRow[], period: Period): Metric {
  const now = inPeriod(pages, period);
  return {
    value: weightedRateOf(now),
    n: now.length,
    confidence: confidenceFor(now.length),
    period,
    previousPeriodValue: weightedRateOf(inPeriod(pages, previousPeriod(period))),
  };
}

/** Share of defects that are a repeat of something seen before. */
export function recurrenceRate(pages: PageRow[], period: Period): Metric {
  const share = (ps: PageRow[]) => {
    const all = ps.flatMap((p) => p.issues);
    return all.length === 0 ? null : round((100 * all.filter(isRecurring).length) / all.length, 1);
  };
  const now = inPeriod(pages, period);
  const issues = now.flatMap((p) => p.issues).length;
  return {
    value: share(now),
    n: issues,
    confidence: confidenceFor(issues),
    period,
    previousPeriodValue: share(inPeriod(pages, previousPeriod(period))),
    note:
      "Counts the legacy REPETITIVE severity as well as the recurring flag. " +
      "Automatic repeat detection is blocked: issue titles carry no content.",
  };
}

// ─── grouped: developer, client, platform ───────────────────────────────────

type KeyOf = (p: PageRow) => string | null;

export const byDeveloper: KeyOf = (p) => p.developerId;
export const byClient: KeyOf = (p) => p.clientId;
export const byPlatform: KeyOf = (p) => p.platform;

/**
 * One cell per group, each carrying its own n and confidence. Groups below
 * MIN_N are returned rather than dropped — the page is expected to show them
 * as suppressed, because "not enough data" is information and a missing row
 * looks like an absence of work.
 *
 * Sorted worst-first among the rankable cells, with suppressed cells after
 * them, so a ranking never opens on a number it cannot support.
 */
export function defectRateBy(
  pages: PageRow[],
  period: Period,
  keyOf: KeyOf,
  opts: { weighted?: boolean } = {},
): Cell[] {
  const rate = opts.weighted ? weightedRateOf : rateOf;
  const group = (ps: PageRow[]) => {
    const m = new Map<string, PageRow[]>();
    for (const p of ps) {
      const k = keyOf(p);
      if (k === null) continue;
      (m.get(k) ?? m.set(k, []).get(k)!).push(p);
    }
    return m;
  };
  const now = group(inPeriod(pages, period));
  const before = group(inPeriod(pages, previousPeriod(period)));

  return [...now.entries()]
    .map(([key, ps]) => ({
      key,
      value: rate(ps),
      n: ps.length,
      confidence: confidenceFor(ps.length),
      period,
      previousPeriodValue: before.has(key) ? rate(before.get(key)!) : null,
    }))
    .sort((a, b) => {
      const rankable = (c: Cell) => (c.confidence === "insufficient" ? 1 : 0);
      return rankable(a) - rankable(b) || (b.value ?? 0) - (a.value ?? 0) || a.key.localeCompare(b.key);
    });
}

// ─── tester adjustment ──────────────────────────────────────────────────────

export type TesterRate = { testerId: string; pages: number; rate: number };

/** Issues per page for each tester, over the period. */
export function testerRates(pages: PageRow[], period: Period): TesterRate[] {
  const m = new Map<string, PageRow[]>();
  for (const p of inPeriod(pages, period)) {
    if (!p.testerId) continue;
    (m.get(p.testerId) ?? m.set(p.testerId, []).get(p.testerId)!).push(p);
  }
  return [...m.entries()]
    .map(([testerId, ps]) => ({ testerId, pages: ps.length, rate: rateOf(ps)! }))
    .sort((a, b) => b.pages - a.pages);
}

/** Who reviewed a developer's work, and in what proportion — the audit trail
 *  that has to sit beside the adjusted number for it to mean anything. */
export type Coverage = { testerId: string; pages: number; share: number };

export function testerCoverage(pages: PageRow[], period: Period, developerId: string): Coverage[] {
  const mine = inPeriod(pages, period).filter((p) => p.developerId === developerId);
  const m = new Map<string, number>();
  for (const p of mine) {
    const k = p.testerId ?? "unassigned";
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return [...m.entries()]
    .map(([testerId, n]) => ({ testerId, pages: n, share: mine.length ? round(n / mine.length, 3) : 0 }))
    .sort((a, b) => b.pages - a.pages);
}

export type AdjustedCell = Cell & {
  raw: number | null;
  coverage: Coverage[];
  /** The rate this developer would be expected to show given only who
   *  reviewed them. Adjusted = raw ÷ expected × grand mean. */
  expected: number | null;
};

/**
 * Issues per page is a joint product of how much the developer got wrong and
 * how hard the tester looked. This divides the second out: each developer's
 * raw rate is scaled by the rate their own reviewers run at, relative to the
 * grand mean.
 *
 * Confidence is capped at "low" whenever there are fewer than
 * MIN_TESTERS_FOR_CONFIDENCE usable testers. With two testers this is not a
 * control, it is a two-point correction factor, and the spec's instruction was
 * to say so rather than ship a confounded ranking quietly. With fewer than two
 * there is nothing to adjust against at all and every cell comes back
 * "insufficient" with the raw rate still attached, so the page can show the
 * confounded number explicitly labelled rather than silently.
 */
export function testerAdjustedDefectRate(pages: PageRow[], period: Period): AdjustedCell[] {
  const usable = testerRates(pages, period).filter((t) => t.pages >= MIN_TESTER_PAGES);
  const scoped = inPeriod(pages, period);
  const grandMean = rateOf(scoped.filter((p) => p.testerId !== null));
  const rateByTester = new Map(usable.map((t) => [t.testerId, t.rate]));

  const cap: Confidence = usable.length >= MIN_TESTERS_FOR_CONFIDENCE ? "high" : "low";
  const adjustable = usable.length >= 2 && grandMean !== null && grandMean > 0;

  const raw = defectRateBy(pages, period, byDeveloper);

  return raw.map((cell) => {
    const coverage = testerCoverage(pages, period, cell.key);
    // Expected rate = the reviewer mix weighted by each reviewer's own rate.
    // Pages reviewed by a tester too small to trust fall out of the mix.
    const weighed = coverage.filter((c) => rateByTester.has(c.testerId));
    const covered = sum(weighed.map((c) => c.pages));
    const expected =
      covered === 0
        ? null
        : round(sum(weighed.map((c) => c.pages * rateByTester.get(c.testerId)!)) / covered);

    if (!adjustable || expected === null || expected === 0) {
      return {
        ...cell,
        value: null,
        raw: cell.value,
        expected,
        coverage,
        confidence: "insufficient" as Confidence,
        note:
          usable.length < 2
            ? "Not enough tester data to separate developer quality from tester thoroughness — raw rate shown, unadjusted."
            : "No reviewer with enough pages to adjust against — raw rate shown, unadjusted.",
      };
    }

    return {
      ...cell,
      value: round((cell.value ?? 0) / expected * grandMean),
      raw: cell.value,
      expected,
      coverage,
      confidence: cell.confidence === "insufficient" ? "insufficient" : cap,
      note:
        cap === "low"
          ? `Adjusted against ${usable.length} testers — a correction factor, not a control. Treat the ordering as indicative.`
          : undefined,
    };
  });
}

// ─── tester calibration ─────────────────────────────────────────────────────

export type CalibrationCell = Cell & {
  severityMix: Record<string, number>;
  /** Ratio to the mean tester rate. 1.0 is the middle; >1 finds more. */
  divergence: number | null;
};

/**
 * Framed as calibration, never as performance: a tester finding more than the
 * mean is not better or worse, it is differently tuned, and two testers whose
 * rates diverge make every per-developer number suspect.
 */
export function testerCalibration(pages: PageRow[], period: Period): CalibrationCell[] {
  const scoped = inPeriod(pages, period).filter((p) => p.testerId !== null);
  const mean = rateOf(scoped);
  const before = previousPeriod(period);
  const rates = testerRates(pages, period);
  const ratesBefore = new Map(testerRates(pages, before).map((t) => [t.testerId, t.rate]));

  return rates.map((t) => {
    const mine = scoped.filter((p) => p.testerId === t.testerId);
    const issues = mine.flatMap((p) => p.issues);
    const mix: Record<string, number> = {};
    for (const i of issues) mix[i.severity] = (mix[i.severity] ?? 0) + 1;
    return {
      key: t.testerId,
      value: t.rate,
      n: t.pages,
      confidence: confidenceFor(t.pages),
      period,
      previousPeriodValue: ratesBefore.get(t.testerId) ?? null,
      severityMix: mix,
      divergence: mean && mean > 0 ? round(t.rate / mean) : null,
    };
  });
}
