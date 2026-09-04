// RESPONSIVE VIEW — pure shaping for the site Layout tab. No I/O, no React.
//
// The engine already collapses per-width findings into ranges, so this layer
// only decides order, tone and the one-line summary a non-technical reader
// sees first.

export type ResponsiveFinding = {
  id: string;
  status: "FAIL" | "WARN" | "PASS" | "INFO" | "SKIP";
  title: string;
  detail?: string;
  evidence?: string[];
};

export type ResponsiveReport = {
  findings?: ResponsiveFinding[];
  shot_widths?: number[];
  elapsed?: number;
  blocked?: number;
  hits?: string[];
  errors?: string[];
};

export const FINDING_TONE: Record<
  ResponsiveFinding["status"],
  "error" | "warning" | "success" | "info" | "neutral"
> = {
  FAIL: "error",
  WARN: "warning",
  PASS: "success",
  INFO: "info",
  SKIP: "neutral",
};

// Worst first. A page with one FAIL and six PASSes must not open with a wall
// of green — the same worst-first rule the sites list uses.
const RANK: Record<ResponsiveFinding["status"], number> = {
  FAIL: 0, WARN: 1, SKIP: 2, INFO: 3, PASS: 4,
};

export function orderFindings(findings: ResponsiveFinding[]): ResponsiveFinding[] {
  return [...findings].sort((a, b) => (RANK[a.status] ?? 9) - (RANK[b.status] ?? 9));
}

/** Screenshot widths, always ascending, ignoring anything malformed. */
export function shotWidths(report: ResponsiveReport | null): number[] {
  const raw = report?.shot_widths ?? [];
  return raw.filter((w) => Number.isFinite(w) && w > 0).sort((a, b) => a - b);
}

export type ResponsiveSummary = {
  fail: number;
  warn: number;
  headline: string;
  tone: "error" | "warning" | "success" | "neutral";
};

/** One sentence for someone who will not read the findings list. */
export function summarize(
  findings: ResponsiveFinding[],
  widths: number,
): ResponsiveSummary {
  const fail = findings.filter((f) => f.status === "FAIL").length;
  const warn = findings.filter((f) => f.status === "WARN").length;
  if (!findings.length) {
    return { fail: 0, warn: 0, headline: "No sweep has run yet.", tone: "neutral" };
  }
  if (fail) {
    return {
      fail, warn,
      headline: `${fail} thing${fail > 1 ? "s" : ""} ${fail > 1 ? "break" : "breaks"} at some screen sizes.`,
      tone: "error",
    };
  }
  if (warn) {
    return {
      fail, warn,
      headline: `${warn} thing${warn > 1 ? "s" : ""} worth a look in the screenshots.`,
      tone: "warning",
    };
  }
  return {
    fail, warn,
    headline: `Nothing broke across ${widths} screen widths.`,
    tone: "success",
  };
}

/** Progress bar width, clamped — the backend advances optimistically and can
 *  report more than 100 if a page needs extra settle passes. */
export function progressPercent(p: { percent?: number } | null | undefined): number {
  const n = p?.percent;
  if (typeof n !== "number" || !Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

/** "350px" / "1440px" — a label a layman reads as a phone or a laptop. */
export function widthLabel(w: number): string {
  if (w <= 470) return `${w}px · phone`;
  if (w <= 820) return `${w}px · tablet`;
  return `${w}px · desktop`;
}
