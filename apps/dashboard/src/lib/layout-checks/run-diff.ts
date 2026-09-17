// WHAT CHANGED SINCE THE LAST RUN.
//
// The verdict line compares counts: "1 fewer than the last run". Counts hide
// the thing anyone re-running a check after a fix wants to know — did the fix
// land, and did anything new turn up while it was being made. Two runs with
// four errors each can be four fixed and four new. This names them.
//
// A fault's identity is the same one reach.ts uses: the rule on the same
// selector, or the rule alone for a page-level rule. That is what the rest of
// the tool means by "the same finding", so this agrees with the "9 of 14
// devices" chips rather than inventing a second notion. On the Viewports tab
// a finding is one rule with a status across widths, so the identity there is
// the rule, and a change is its status crossing the line into or out of
// FAIL/WARN.
//
// Pure, so every rule is unit tested without a run.

import { reachKey } from "@/lib/layout-checks/reach";

export type RunDiff = {
  /** Reported last run, gone now. */
  fixed: string[];
  /** Reported now, not last run. */
  added: string[];
  /** Reported both times. */
  kept: string[];
};

export type Since = "new" | "still";

type DeviceLike = { status: string; findings: { rule: string; selector?: string | null; scope?: string }[] };

/** The set of faults a device run reports, across every device that was audited. */
function deviceKeys(devices: DeviceLike[]): Set<string> {
  const out = new Set<string>();
  for (const d of devices) {
    if (d.status !== "ok") continue;
    for (const f of d.findings) out.add(reachKey(f.rule, f.selector, f.scope));
  }
  return out;
}

function diffKeys(cur: Set<string>, prev: Set<string>): RunDiff {
  const fixed = [...prev].filter((k) => !cur.has(k));
  const added = [...cur].filter((k) => !prev.has(k));
  const kept = [...cur].filter((k) => prev.has(k));
  return { fixed, added, kept };
}

/**
 * The Devices tab: which faults went, which arrived, which stayed — across
 * the fleet, so a fault that moved from one device to another is "still
 * there", which is what it is. Null without a previous run: nothing to say.
 */
export function diffDevices(cur: DeviceLike[], prev: DeviceLike[] | null | undefined): RunDiff | null {
  if (!prev) return null;
  return diffKeys(deviceKeys(cur), deviceKeys(prev));
}

type ViewportLike = { id: string; status: string };

/** A Viewports finding counts when its status is one someone has to act on. */
function viewportKeys(findings: ViewportLike[]): Set<string> {
  return new Set(findings.filter((f) => f.status === "FAIL" || f.status === "WARN").map((f) => f.id));
}

/** The Viewports tab: the rules whose status crossed into or out of FAIL/WARN. */
export function diffViewports(cur: ViewportLike[], prev: ViewportLike[] | null | undefined): RunDiff | null {
  if (!prev) return null;
  return diffKeys(viewportKeys(cur), viewportKeys(prev));
}

/** "new" for a fault this run introduced, "still" for one the last run had too. */
export function sinceOf(diff: RunDiff | null | undefined, key: string): Since | null {
  if (!diff) return null;
  if (diff.added.includes(key)) return "new";
  if (diff.kept.includes(key)) return "still";
  return null;
}

const n = (count: number, one: string, many = one) => `${count} ${count === 1 ? one : many}`;

/**
 * The line under the verdict. Null without a previous run, and null when the
 * two runs report the same faults — the verdict's own "Same as the last run"
 * already says that, and saying it twice is noise.
 */
export function changesLine(diff: RunDiff | null | undefined): string | null {
  if (!diff) return null;
  if (!diff.fixed.length && !diff.added.length) return null;
  const parts: string[] = [];
  if (diff.fixed.length) parts.push(`${n(diff.fixed.length, "fixed")}`);
  if (diff.added.length) parts.push(`${n(diff.added.length, "new")}`);
  if (diff.kept.length) parts.push(`${diff.kept.length} still there`);
  return `Since the last run: ${parts.join(" · ")}`;
}
