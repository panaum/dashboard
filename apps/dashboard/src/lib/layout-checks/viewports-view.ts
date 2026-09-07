// VIEWPORTS VIEW — pure shaping for the eight-width sweep, mirroring
// devices-view.ts for the other tab. No I/O, no React.
//
// The engine now attributes every finding to the widths it is about
// (`widths`, added in responsive_engine.py and its pagecheck mirror). A run
// saved before that has findings with no `widths` at all: those runs are shown
// unfiltered, and the panel says so out loud. Nothing here invents an
// attribution the run does not carry.

import type { ResponsiveFinding } from "@/lib/linkspy/responsive-view";
import type { RailItem } from "@/components/layout-checks/findings-rail";

export type ViewportFinding = ResponsiveFinding & { widths?: number[] };
export type WidthShape = "phone" | "tablet" | "desktop";
export type WidthSeverity = "error" | "warning" | "clean" | "unknown";

// The sweep's own widths and the heights it renders them at, mirrored from
// WIDTHS in services/linkspy-api/responsive_engine.py. A stored screenshot
// records only its width, and the frame needs a viewport to shape itself.
const HEIGHTS: Record<number, number> = {
  350: 750, 375: 812, 425: 900, 450: 900, 470: 900, 768: 1024, 1024: 768, 1440: 900,
};

export function widthViewport(w: number): { width: number; height: number } {
  return { width: w, height: HEIGHTS[w] ?? 900 };
}

/** The same cut widthLabel() uses, so the two never disagree. */
export function widthShape(w: number): WidthShape {
  if (w <= 470) return "phone";
  if (w <= 820) return "tablet";
  return "desktop";
}

/** Does this run carry per-width attribution at all? */
export function hasPerWidth(findings: ViewportFinding[]): boolean {
  return findings.some((f) => Array.isArray(f.widths));
}

/** A finding with no widths is unattributed, not absent: it applies everywhere. */
export function appliesAt(f: ViewportFinding, width: number): boolean {
  return Array.isArray(f.widths) ? f.widths.includes(width) : true;
}

export function findingsAt(findings: ViewportFinding[], width: number): ViewportFinding[] {
  return findings.filter((f) => appliesAt(f, width));
}

/** What the dot on a width's pill says. "unknown" when the run predates widths. */
export function severityAt(findings: ViewportFinding[], width: number): WidthSeverity {
  if (!hasPerWidth(findings)) return "unknown";
  const here = findingsAt(findings, width);
  if (here.some((f) => f.status === "FAIL")) return "error";
  if (here.some((f) => f.status === "WARN" || f.status === "SKIP")) return "warning";
  return "clean";
}

/** Open on the worst width, smallest first — phones break more and matter more. */
export function defaultWidth(findings: ViewportFinding[], widths: number[]): number | null {
  const asc = [...widths].sort((a, b) => a - b);
  if (!asc.length) return null;
  if (!hasPerWidth(findings)) return asc[0];
  return asc.find((w) => severityAt(findings, w) === "error")
    ?? asc.find((w) => severityAt(findings, w) === "warning")
    ?? asc[0];
}

/** "350–470, 1440" — contiguous runs collapsed, like the engine's own prose. */
export function rangeLabel(widths: number[], all: number[]): string {
  const order = [...new Set(all)].sort((a, b) => a - b);
  const idx = [...new Set(widths)].map((w) => order.indexOf(w)).filter((i) => i >= 0).sort((a, b) => a - b);
  if (!idx.length) return "";
  const groups: number[][] = [];
  for (const i of idx) {
    const last = groups[groups.length - 1];
    if (last && i === last[last.length - 1] + 1) last.push(i);
    else groups.push([i]);
  }
  return groups.map((g) => (g.length === 1 ? `${order[g[0]]}` : `${order[g[0]]}–${order[g[g.length - 1]]}`)).join(", ");
}

const RANK: Record<string, number> = { FAIL: 0, WARN: 1, SKIP: 2 };

/**
 * The rail for one width. PASS and INFO are dropped: "no sideways scroll" and
 * the screenshot list are not findings, and five rows of reassurance would
 * bury the one row that matters. A width with nothing left gets the rail's
 * clean state.
 */
export function viewportRail(
  findings: ViewportFinding[],
  width: number,
  all: number[],
): RailItem[] {
  const perWidth = hasPerWidth(findings);
  return findingsAt(findings, width)
    .filter((f) => f.status === "FAIL" || f.status === "WARN" || f.status === "SKIP")
    .sort((a, b) => (RANK[a.status] ?? 9) - (RANK[b.status] ?? 9))
    .map((f) => ({
      id: f.id,
      severity: f.status === "FAIL" ? ("error" as const) : ("warn" as const),
      rule: f.id,
      label: f.title,
      // The mono line under a device finding is its selector; here it is the
      // widths the finding is about, which is the equivalent "where".
      selector: perWidth && f.widths?.length ? `${rangeLabel(f.widths, all)}px` : "widths not recorded",
      box: null,
      pageLevel: false,
      detail: f.detail || undefined,
    }));
}

/** Where to jump when a finding is selected: its first width, if it names any. */
export function firstWidthOf(f: ViewportFinding | undefined, fallback: number | null): number | null {
  if (!f || !Array.isArray(f.widths) || !f.widths.length) return fallback;
  return [...f.widths].sort((a, b) => a - b)[0];
}
