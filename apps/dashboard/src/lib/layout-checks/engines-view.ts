// Pure shaping for engine comparison. Only the desktop baselines cover all
// three engines at one width, so comparison is offered there and nowhere
// else — there is no Firefox iPhone to compare against. Findings are matched
// across engines by rule and selector; one that shows up in a single engine
// is the divergence the view exists to expose.

import type { DeviceInput } from "@/lib/layout-checks/devices-view";
import { engineLabel } from "@/lib/layout-checks/devices-view";
import { railItems, type RailFinding } from "@/lib/layout-checks/findings-view";

export type EngineColumn = {
  profileId: string;
  engine: string;
  engineLabel: string;
  status: string;
  error: string | null;
  errors: number;
  warnings: number;
  items: (RailFinding & { onlyHere: boolean })[];
};

/** The desktop profiles that share the selected profile's viewport, in a
 *  fixed engine order. Empty unless at least two engines are present. */
export function comparableEngines(devices: DeviceInput[], selectedProfileId: string): DeviceInput[] {
  const sel = devices.find((d) => d.profile_id === selectedProfileId);
  if (!sel || sel.is_mobile) return [];
  const same = devices.filter((d) => !d.is_mobile && d.viewport.width === sel.viewport.width && d.viewport.height === sel.viewport.height);
  const order = ["chromium", "firefox", "webkit"];
  const byEngine = new Map<string, DeviceInput>();
  for (const d of same) if (!byEngine.has(d.engine)) byEngine.set(d.engine, d);
  const cols = order.filter((e) => byEngine.has(e)).map((e) => byEngine.get(e)!);
  return cols.length >= 2 ? cols : [];
}

const key = (f: RailFinding) => `${f.rule}|${f.selector ?? (f.pageLevel ? "page" : "")}`;

/** One column per engine, each finding marked when no other engine has it. */
export function engineColumns(cols: DeviceInput[]): EngineColumn[] {
  const itemsByEngine = cols.map((d) => railItems(d.findings));
  const seenIn = new Map<string, number>();
  for (const items of itemsByEngine) {
    for (const k of new Set(items.map(key))) seenIn.set(k, (seenIn.get(k) ?? 0) + 1);
  }
  return cols.map((d, i) => ({
    profileId: d.profile_id,
    engine: d.engine,
    engineLabel: engineLabel(d.engine),
    status: d.status,
    error: d.error ?? null,
    errors: d.findings.filter((f) => f.severity === "error").length,
    warnings: d.findings.filter((f) => f.severity === "warn").length,
    items: itemsByEngine[i].map((it) => ({ ...it, onlyHere: (seenIn.get(key(it)) ?? 0) === 1 })),
  }));
}
