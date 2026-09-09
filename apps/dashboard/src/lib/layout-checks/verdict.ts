// The one sentence someone reads in two seconds, for each tab of the Layout
// checks site page, and the quieter line under it that says how this run
// compares with the last. Pure: no Prisma, no React, no clock read — the
// caller may pass `nowMs` (tests do), so every rule is unit tested; a
// component leaves it out and stays free of render-time clock reads.

import type { DpReport } from "@/lib/devicepreview/history";
import { countsOf } from "@/lib/devicepreview/history";
import type { ResponsiveFinding } from "@/lib/linkspy/responsive-view";

export type Tone = "success" | "error" | "warning" | "neutral";

export type TabVerdict = {
  headline: string;
  tone: Tone;
  /** "1 fewer than the last run, 4 hours ago" — null on a first run. */
  compare: string | null;
};

export type ProblemCounts = { errors: number; warnings: number; checkedAt: string };

const plural = (n: number, one: string, many = one + "s") => `${n} ${n === 1 ? one : many}`;

/** "just now", "5 minutes ago", "4 hours ago", "3 days ago". Words, not "4h". */
export function agoWords(iso: string, nowMs: number): string {
  const s = Math.max(0, Math.round((nowMs - new Date(iso).getTime()) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${plural(m, "minute")} ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${plural(h, "hour")} ago`;
  const d = Math.round(h / 24);
  return `${plural(d, "day")} ago`;
}

/** Errors are compared when either run has any; otherwise warnings. */
export function compareLine(cur: ProblemCounts, prev: ProblemCounts | null, nowMs: number): string | null {
  if (!prev) return null;
  const when = agoWords(prev.checkedAt, nowMs);
  const onErrors = cur.errors > 0 || prev.errors > 0;
  const delta = onErrors ? cur.errors - prev.errors : cur.warnings - prev.warnings;
  if (delta === 0) return `Same as the last run, ${when}`;
  const word = onErrors ? "" : " warning";
  return `${Math.abs(delta)}${word}${Math.abs(delta) === 1 || word === "" ? "" : "s"} ${delta < 0 ? "fewer" : "more"} than the last run, ${when}`;
}

export type DevicesRun = { report: DpReport; checkedAt: string };

export function devicesVerdict(cur: DevicesRun | null, prev: DevicesRun | null, nowMs: number = Date.now()): TabVerdict {
  if (!cur) return { headline: "Not run yet", tone: "neutral", compare: null };
  const c = countsOf(cur.report);
  const s = cur.report.summary;
  const n = c.deviceCount;
  const counts = (r: DevicesRun): ProblemCounts => {
    const k = countsOf(r.report);
    return { errors: k.errorCount + k.regressedCount, warnings: k.warnCount, checkedAt: r.checkedAt };
  };
  const compare = compareLine(counts(cur), prev ? counts(prev) : null, nowMs);
  const walls = (s.devicesBlocked ?? []).length + (s.devicesFailed ?? []).length;
  // A device that never rendered vouches for nothing, and a headline about
  // errors alone implies all fourteen were looked at. Say it either way.
  const missed = walls ? ` · ${walls} not captured` : "";
  if (c.errorCount > 0) {
    return { tone: "error", compare,
      headline: `${plural(c.errorCount, "ship-blocking issue")} on ${s.devicesWithErrors.length} of ${n} devices${missed}` };
  }
  if (c.regressedCount > 0) {
    return { tone: "error", compare,
      headline: `Visual regression on ${plural(c.regressedCount, "device")} since the last run${missed}` };
  }
  if (walls) {
    return { tone: "neutral", compare, headline: `Inconclusive on ${plural(walls, "device")} of ${n} — blocked or failed to capture` };
  }
  if (c.warnCount > 0) {
    return { tone: "warning", compare, headline: `No breaks · ${plural(c.warnCount, "warning")} to review across ${n} devices` };
  }
  return { tone: "success", compare, headline: `Clean across all ${n} devices` };
}

export type ViewportsRun = { findings: ResponsiveFinding[]; widths: number[]; checkedAt: string };

export function viewportsVerdict(cur: ViewportsRun | null, prev: ViewportsRun | null, nowMs: number = Date.now()): TabVerdict {
  if (!cur) return { headline: "Not run yet", tone: "neutral", compare: null };
  const count = (r: ViewportsRun): ProblemCounts => ({
    errors: r.findings.filter((f) => f.status === "FAIL").length,
    warnings: r.findings.filter((f) => f.status === "WARN").length,
    checkedAt: r.checkedAt,
  });
  const c = count(cur);
  const compare = compareLine(c, prev ? count(prev) : null, nowMs);
  const n = cur.widths.length || 8;
  if (c.errors > 0) {
    return { tone: "error", compare, headline: `${plural(c.errors, "thing")} ${c.errors === 1 ? "breaks" : "break"} at some of the ${n} widths` };
  }
  if (cur.findings.some((f) => f.status === "SKIP")) {
    return { tone: "neutral", compare, headline: `Inconclusive — some widths were blocked or did not load` };
  }
  if (c.warnings > 0) {
    return { tone: "warning", compare, headline: `No breaks · ${plural(c.warnings, "thing")} worth a look across ${n} widths` };
  }
  return { tone: "success", compare, headline: `Clean at all ${n} widths` };
}
