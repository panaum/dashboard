// Pure shaping for the Devices tab: which group a profile sits in, what to
// call its engine, how bad it is, what order the picker shows, and which
// device opens by default. No React, no I/O — all of it unit tested.

import type { DpDevice } from "@/lib/devicepreview/history";
import type { Tone } from "@/lib/layout-checks/verdict";

export type Shape = "phone" | "tablet" | "desktop";
export type Group = "Apple" | "Android" | "Tablet" | "Desktop";
export type Severity = "error" | "warning" | "clean" | "inconclusive";

export type DeviceView = {
  profileId: string;
  label: string;
  engine: string;
  engineLabel: string;
  group: Group;
  shape: Shape;
  viewport: { width: number; height: number };
  viewportLabel: string;
  severity: Severity;
  errors: number;
  warnings: number;
  status: string;
  error: string | null;
  /** matrix position, kept so ties in the sort stay stable */
  index: number;
};

export type DeviceInput = DpDevice & {
  viewport: { width: number; height: number };
  is_mobile?: boolean;
  device_scale_factor?: number;
};

const ENGINE: Record<string, string> = { webkit: "WebKit", chromium: "Chromium", firefox: "Gecko" };

export function engineLabel(engine: string): string {
  return ENGINE[engine] ?? engine;
}

export function shapeOf(d: { is_mobile?: boolean; viewport: { width: number; height: number } }): Shape {
  if (!d.is_mobile) return "desktop";
  return Math.min(d.viewport.width, d.viewport.height) < 600 ? "phone" : "tablet";
}

export function groupOf(d: { platform: string; is_mobile?: boolean; viewport: { width: number; height: number } }): Group {
  const shape = shapeOf(d);
  if (shape === "desktop") return "Desktop";
  if (shape === "tablet") return "Tablet";
  return d.platform === "ios" ? "Apple" : "Android";
}

export const GROUP_ORDER: Group[] = ["Apple", "Android", "Tablet", "Desktop"];

export function severityOf(d: { status: string; findings: { severity: string }[] }): Severity {
  if (d.status !== "ok") return "inconclusive";
  if (d.findings.some((f) => f.severity === "error")) return "error";
  if (d.findings.some((f) => f.severity === "warn")) return "warning";
  return "clean";
}

// Broken first, then warnings, then clean. A capture that could not vouch
// for the page (blocked, failed) sorts to the front: it needs a look most.
const RANK: Record<Severity, number> = { inconclusive: 0, error: 1, warning: 2, clean: 3 };

export function toView(d: DeviceInput, index: number): DeviceView {
  const sev = severityOf(d);
  return {
    profileId: d.profile_id,
    label: d.label,
    engine: d.engine,
    engineLabel: engineLabel(d.engine),
    group: groupOf(d),
    shape: shapeOf(d),
    viewport: d.viewport,
    viewportLabel: `${d.viewport.width} × ${d.viewport.height}`,
    severity: sev,
    errors: d.findings.filter((f) => f.severity === "error").length,
    warnings: d.findings.filter((f) => f.severity === "warn").length,
    status: d.status,
    error: d.error ?? null,
    index,
  };
}

export function sortDevices(views: DeviceView[]): DeviceView[] {
  return [...views].sort((a, b) =>
    RANK[a.severity] - RANK[b.severity] || b.errors - a.errors || b.warnings - a.warnings || a.index - b.index);
}

/** Groups in a fixed order, each sorted worst first; empty groups omitted. */
export function groupDevices(views: DeviceView[]): { group: Group; devices: DeviceView[] }[] {
  return GROUP_ORDER
    .map((group) => ({ group, devices: sortDevices(views.filter((v) => v.group === group)) }))
    .filter((g) => g.devices.length > 0);
}

/** One line for a collapsed group: what is wrong inside it, without opening it.
 *  Counts devices, not findings — the question a closed group has to answer is
 *  "is there anything in here for me", not "how bad". */
export function groupSummary(devices: DeviceView[]): { label: string; tone: Tone } {
  const n = (s: Severity) => devices.filter((d) => d.severity === s).length;
  const errors = n("error"), warnings = n("warning"), out = n("inconclusive");
  if (errors) return { label: `${errors} with error${errors === 1 ? "" : "s"}`, tone: "error" };
  if (warnings) return { label: `${warnings} to review`, tone: "warning" };
  if (out) return { label: `${out} not captured`, tone: "neutral" };
  return { label: "all clean", tone: "success" };
}

/** The group a device belongs to, for opening the picker on the right one. */
export function groupOfProfile(views: DeviceView[], profileId: string | null): Group | null {
  return views.find((v) => v.profileId === profileId)?.group ?? null;
}

/** The worst device opens by default; if everything is clean, the smallest
 *  phone — or the narrowest profile when there are no phones. */
export function defaultSelection(views: DeviceView[]): string | null {
  if (!views.length) return null;
  const sorted = sortDevices(views);
  if (sorted[0].severity !== "clean") return sorted[0].profileId;
  const phones = views.filter((v) => v.shape === "phone");
  const pool = phones.length ? phones : views;
  return pool.reduce((best, v) => (v.viewport.width < best.viewport.width ? v : best)).profileId;
}
