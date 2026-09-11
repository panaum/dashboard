// The device health matrix: every device against every check, in one look.
//
// The picker used to be a dropdown and a strip of coloured squares — one
// colour per device, the worst thing about it. This is the same fourteen
// devices as rows and the six checks as columns, so the question "is it the
// tap targets everywhere, or just on the SE?" is answered by a glance down a
// column instead of fourteen clicks. Pure: the rows are computed here and
// tested; the component only draws them.

import type { DeviceView } from "@/lib/layout-checks/devices-view";

export type CheckId = "shift" | "tap" | "text" | "images" | "overflow" | "fonts";

export type Check = {
  id: CheckId;
  label: string;
  /** The audit rules that roll up into this column. */
  rules: string[];
  /** Engines that can measure it at all; others show "can't measure". */
  engines?: string[];
};

// Layout shift is a Chromium-only measurement: WebKit and Gecko report
// nothing, which the cell must show as "cannot say" rather than "clean".
export const CHECKS: Check[] = [
  { id: "shift", label: "Shift", rules: ["cls"], engines: ["chromium"] },
  { id: "tap", label: "Tap targets", rules: ["tap-small", "tap-close"] },
  { id: "text", label: "Text", rules: ["text-small"] },
  { id: "images", label: "Images", rules: ["image-size"] },
  { id: "overflow", label: "Overflow", rules: ["overflow", "element-wider", "clipped-text", "offscreen", "fixed-chrome", "viewport-meta"] },
  { id: "fonts", label: "Fonts", rules: ["webfont"] },
];

export type CellTone = "error" | "warning" | "clean" | "na";

export type Cell = {
  check: CheckId;
  tone: CellTone;
  /** What the cell shows: the count of errors + warnings, or nothing. */
  count: number;
  errors: number;
  warnings: number;
};

export type Finding = { severity: string; rule: string };

/** One row of cells for a device, from its raw findings. A device that was
 *  blocked or failed to capture has nothing to say in any column. */
export function cellsFor(d: { engine: string; status: string; findings: Finding[] }): Cell[] {
  return CHECKS.map((c) => {
    if (d.status !== "ok" || (c.engines && !c.engines.includes(d.engine))) {
      return { check: c.id, tone: "na", count: 0, errors: 0, warnings: 0 };
    }
    const mine = d.findings.filter((f) => c.rules.includes(f.rule));
    const errors = mine.filter((f) => f.severity === "error").length;
    const warnings = mine.filter((f) => f.severity === "warn").length;
    const tone: CellTone = errors ? "error" : warnings ? "warning" : "clean";
    return { check: c.id, tone, count: errors + warnings, errors, warnings };
  });
}

export type Coverage = { failing: number; warnings: number; clean: number; inconclusive: number };

/** How the run splits by device, for the chips under the verdict. */
export function coverage(views: DeviceView[]): Coverage {
  const n = (s: DeviceView["severity"]) => views.filter((v) => v.severity === s).length;
  return { failing: n("error"), warnings: n("warning"), clean: n("clean"), inconclusive: n("inconclusive") };
}

/** Words for a cell, for its title and for a screen reader. */
export function cellWords(cell: Cell, check: Check): string {
  if (cell.tone === "na") return `${check.label}: not measured on this device`;
  if (cell.tone === "clean") return `${check.label}: clean`;
  const parts = [];
  if (cell.errors) parts.push(`${cell.errors} error${cell.errors === 1 ? "" : "s"}`);
  if (cell.warnings) parts.push(`${cell.warnings} warning${cell.warnings === 1 ? "" : "s"}`);
  return `${check.label}: ${parts.join(", ")}`;
}
