// Pure helpers over a devicepreview report (schemaVersion 1). No Prisma, no
// React, no clock — so every rule is unit tested and the page stays thin.

export type DpSummary = {
  errors: number;
  warnings: number;
  infos: number;
  devicesPassed: number;
  devicesWithErrors: string[];
  devicesWithWarnings?: string[];
  devicesFailed: string[];
  devicesBlocked: string[];
  devicesRegressed?: string[];
};

export type DpDevice = {
  profile_id: string;
  label: string;
  engine: string;
  platform: string;
  status: string;
  error?: string | null;
  findings: { severity: string; rule: string; message: string; selector?: string; scope?: string }[];
  diff?: { percent?: number; regressed?: boolean; missing?: boolean } | null;
  images?: Record<string, string>;
};

export type DpReport = {
  schemaVersion: number;
  url: string;
  startedAt: string;
  finishedAt?: string;
  summary: DpSummary;
  devices: DpDevice[];
  baseline?: { dir?: string; startedAt?: string } | null;
};

export type Worst = "FAIL" | "REGRESSED" | "BLOCKED" | "WARN" | "PASS";

export type RunCounts = {
  worst: Worst;
  deviceCount: number;
  errorCount: number;
  warnCount: number;
  regressedCount: number;
};

/** What a list needs to know about a run, derived once from the report. */
export function countsOf(report: DpReport): RunCounts {
  const s = report.summary;
  const regressed = (s.devicesRegressed ?? []).length;
  const blocked = (s.devicesBlocked ?? []).length + (s.devicesFailed ?? []).length;
  const worst: Worst = s.errors > 0 ? "FAIL" : regressed > 0 ? "REGRESSED" : blocked > 0 ? "BLOCKED"
    : s.warnings > 0 ? "WARN" : "PASS";
  return {
    worst,
    deviceCount: report.devices.length,
    errorCount: s.errors,
    warnCount: s.warnings,
    regressedCount: regressed,
  };
}

export const WORST_TONE: Record<Worst, "error" | "warning" | "neutral" | "success"> = {
  FAIL: "error", REGRESSED: "error", BLOCKED: "neutral", WARN: "warning", PASS: "success",
};

/** The one sentence a tester reads first. */
export function verdictLine(c: RunCounts, report: DpReport): string {
  const s = report.summary;
  if (c.errorCount > 0) {
    const n = s.devicesWithErrors.length;
    return `${c.errorCount} ship-blocking issue${c.errorCount === 1 ? "" : "s"} on ${n} of ${c.deviceCount} devices`;
  }
  if (c.regressedCount > 0) {
    return `Visual regression on ${c.regressedCount} device${c.regressedCount === 1 ? "" : "s"} against the last run`;
  }
  const walls = (s.devicesBlocked ?? []).length, failed = (s.devicesFailed ?? []).length;
  if (walls || failed) {
    const parts = [walls ? `blocked by bot protection on ${walls}` : "", failed ? `capture failed on ${failed}` : ""].filter(Boolean);
    return `Inconclusive — ${parts.join(", ")} of ${c.deviceCount} devices`;
  }
  if (c.warnCount > 0) return `No errors · ${c.warnCount} warning${c.warnCount === 1 ? "" : "s"} to review`;
  return `All ${c.deviceCount} devices clean`;
}

export type Delta = { errors: number; warnings: number; regressed: number };

/** Current minus previous; null when there is nothing to compare with. */
export function deltaOf(prev: RunCounts | null, cur: RunCounts): Delta | null {
  if (!prev) return null;
  return {
    errors: cur.errorCount - prev.errorCount,
    warnings: cur.warnCount - prev.warnCount,
    regressed: cur.regressedCount - prev.regressedCount,
  };
}

/** "2 fewer errors, 1 more warning than the last run" — or the quiet cases. */
export function deltaLine(d: Delta | null): string {
  if (!d) return "First run for this page.";
  const bits: string[] = [];
  const word = (n: number, w: string) => `${Math.abs(n)} ${n < 0 ? "fewer" : "more"} ${w}${Math.abs(n) === 1 ? "" : "s"}`;
  if (d.errors) bits.push(word(d.errors, "error"));
  if (d.warnings) bits.push(word(d.warnings, "warning"));
  if (!bits.length) return "Same counts as the last run.";
  return bits.join(", ") + " than the last run.";
}

/** Per-device rows for the summary table, worst first. */
export function deviceRows(report: DpReport) {
  const sev = (d: DpDevice) => d.findings.reduce((acc, f) => { acc[f.severity] = (acc[f.severity] ?? 0) + 1; return acc; }, {} as Record<string, number>);
  const score = (d: DpDevice, c: Record<string, number>) =>
    (d.status !== "ok" ? 1e9 : 0) + (d.diff?.regressed ? 5e5 : 0) + (c.error ?? 0) * 1e6 + (c.warn ?? 0) * 1e3 + (c.info ?? 0);
  return report.devices
    .map((d) => { const c = sev(d); return { d, c, score: score(d, c) }; })
    .sort((a, b) => b.score - a.score)
    .map(({ d, c }) => ({
      profileId: d.profile_id,
      label: d.label,
      engine: d.engine,
      platform: d.platform,
      status: d.status,
      error: d.error ?? null,
      errors: c.error ?? 0,
      warnings: c.warn ?? 0,
      infos: c.info ?? 0,
      regressed: Boolean(d.diff?.regressed),
      diffPercent: typeof d.diff?.percent === "number" ? d.diff.percent : null,
      worst: d.findings
        .slice()
        .sort((a, b) => sevRank(a.severity) - sevRank(b.severity))[0] ?? null,
    }));
}

function sevRank(s: string): number {
  return s === "error" ? 0 : s === "warn" ? 1 : 2;
}
