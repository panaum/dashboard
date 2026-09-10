// REACH — is this one device's problem, or the site's?
//
// The matrix audits fourteen devices, and the same fault usually appears on
// most of them. Looking at one device you cannot tell which: a tap target
// that is too small on the iPhone alone is a different job from one that is
// too small everywhere. Counting how many audited devices carry the same
// finding turns a list of symptoms into a priority.
//
// "The same finding" means the same rule on the same selector — the pair the
// tools use to identify an element. A page-level rule (layout shift, viewport
// meta) has no selector and is keyed on the rule alone.

export type ReachDevice = {
  status: string;
  findings: { rule: string; selector?: string | null; scope?: string }[];
};

export type Reach = {
  /** Audited devices carrying this finding, including the one being read. */
  devices: number;
  /** Devices whose audit produced findings at all — the denominator. */
  audited: number;
};

export function reachKey(rule: string, selector: string | null | undefined, scope?: string): string {
  return scope === "page" || !selector ? `${rule}|` : `${rule}|${selector}`;
}

/** How many audited devices carry each finding, keyed by rule and selector. */
export function reachMap(devices: ReachDevice[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const d of devices) {
    if (d.status !== "ok") continue;
    // A device counts once per distinct finding, however many times it
    // reported it: "on 9 devices" must mean nine devices, not nine rows.
    const seen = new Set(d.findings.map((f) => reachKey(f.rule, f.selector, f.scope)));
    for (const k of seen) out.set(k, (out.get(k) ?? 0) + 1);
  }
  return out;
}

export function auditedCount(devices: ReachDevice[]): number {
  return devices.filter((d) => d.status === "ok").length;
}

/** The words on the chip, or null when there is nothing worth saying. */
export function reachLabel(reach: Reach | null): string | null {
  if (!reach || reach.audited < 2) return null;
  if (reach.devices <= 1) return "only here";
  if (reach.devices >= reach.audited) return `all ${reach.audited} devices`;
  return `${reach.devices} of ${reach.audited} devices`;
}

/** Everywhere is a site-wide fix; one device is an engine or size quirk. */
export function reachTone(reach: Reach | null): "wide" | "narrow" | null {
  if (!reach || reach.audited < 2) return null;
  return reach.devices <= 1 ? "narrow" : "wide";
}
