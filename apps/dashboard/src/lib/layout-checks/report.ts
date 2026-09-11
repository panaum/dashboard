// THE REPORT — one page you could put in front of the client who owns the site.
//
// The Devices tab answers "what is wrong on this device". A client does not
// have a device in mind: they have a site, and one question — is it ready.
// So the report inverts the axis. A fault that appears on nine devices is ONE
// item here, named once, with the devices it affects listed under it; the
// order is what to do first, not which handset sorted first.
//
// Everything is derived from the run that is already loaded. Pure: no React,
// no clock, no I/O.

import { reachKey } from "@/lib/layout-checks/reach";
import { shortLabel, type RawFinding } from "@/lib/layout-checks/findings-view";
import { checkFor } from "@/lib/layout-checks/matrix";

export type ReportDevice = {
  profileId: string;
  label: string;
  engine: string;
  status: string;
  findings: RawFinding[];
};

export type ReportItem = {
  key: string;
  rule: string;
  severity: "error" | "warn" | "info";
  /** The short label, from the worst example we saw. */
  label: string;
  /** The tool's own sentence, with the numbers. */
  message: string;
  selector: string | null;
  pageLevel: boolean;
  /** Which check column this belongs to, for grouping the report. */
  check: string | null;
  /** Device labels carrying it, in matrix order. */
  devices: string[];
  /** Of how many devices whose audit actually ran. */
  audited: number;
  /** The device where this sits HIGHEST on the page, with its box — for the
      crop. Highest, because only the first screen of each device is always
      stored: a fault 4,000px down has no picture, the same fault 200px down
      on another device does. Null when there is nothing to point at. */
  sample: { profileId: string; label: string; box: { x: number; y: number; width: number; height: number } } | null;
};

const RANK: Record<string, number> = { error: 0, warn: 1, info: 2 };

/** Every distinct fault in the run, worst first, then by how far it reaches.
 *  "Distinct" is the rule and the selector — the pair that identifies an
 *  element — so the same button failing on nine devices is one item. */
export function reportItems(devices: ReportDevice[]): ReportItem[] {
  const audited = devices.filter((d) => d.status === "ok").length;
  const byKey = new Map<string, ReportItem>();

  for (const d of devices) {
    if (d.status !== "ok") continue;
    // A device counts once per distinct fault, however many rows it reported.
    const seen = new Set<string>();
    for (const f of d.findings) {
      const pageLevel = f.scope === "page";
      const key = reachKey(f.rule, f.selector, f.scope);
      const severity = (f.severity === "error" || f.severity === "warn" ? f.severity : "info") as ReportItem["severity"];
      let item = byKey.get(key);
      if (!item) {
        item = {
          key, rule: f.rule, severity,
          label: shortLabel(f), message: f.message,
          selector: pageLevel ? null : (f.selector ?? null),
          pageLevel, check: checkFor(f.rule)?.label ?? null,
          devices: [], audited, sample: null,
        };
        byKey.set(key, item);
      }
      // The worst severity seen anywhere wins, and its wording with it: a
      // fault that fails on one device and warns on another is a failure.
      if (RANK[severity] < RANK[item.severity]) {
        item.severity = severity; item.label = shortLabel(f); item.message = f.message;
      }
      if (!pageLevel && f.box && f.box.width > 0 && f.box.height > 0
          && (!item.sample || f.box.y < item.sample.box.y)) {
        item.sample = { profileId: d.profileId, label: d.label, box: f.box };
      }
      if (!seen.has(key)) { seen.add(key); item.devices.push(d.label); }
    }
  }

  return [...byKey.values()].sort((a, b) =>
    (RANK[a.severity] ?? 9) - (RANK[b.severity] ?? 9)
    || b.devices.length - a.devices.length
    || a.label.localeCompare(b.label));
}

export type Coverage = { failing: number; warnings: number; clean: number; inconclusive: number; audited: number; total: number };

/** How the run splits by device — the three numbers at the top of the report. */
export function reportCoverage(devices: ReportDevice[]): Coverage {
  let failing = 0, warnings = 0, clean = 0, inconclusive = 0;
  for (const d of devices) {
    if (d.status !== "ok") { inconclusive += 1; continue; }
    if (d.findings.some((f) => f.severity === "error")) failing += 1;
    else if (d.findings.some((f) => f.severity === "warn")) warnings += 1;
    else clean += 1;
  }
  return { failing, warnings, clean, inconclusive, audited: devices.length - inconclusive, total: devices.length };
}

/** The one sentence at the top. Plain words: the client is not a tester. */
export function reportVerdict(c: Coverage, blocking: readonly { severity: string }[]): { headline: string; tone: "error" | "warning" | "success" | "neutral" } {
  if (c.total === 0) return { headline: "This page has not been checked yet", tone: "neutral" };
  if (c.audited === 0) return { headline: "Nothing could be checked — every device was blocked or failed to load the page", tone: "neutral" };
  if (blocking.length === 1) return { headline: "One thing stands between this page and launch", tone: "error" };
  if (blocking.length > 1) return { headline: `${blocking.length} things stand between this page and launch`, tone: "error" };
  if (c.warnings > 0) return { headline: "Nothing is broken — a few things are worth tidying", tone: "warning" };
  return { headline: `Clean on all ${c.audited} devices we checked`, tone: "success" };
}

/** "on all 14 devices", "on 9 of 14 devices", "on the iPhone SE only". */
export function reachWords(item: ReportItem): string {
  const n = item.devices.length;
  if (n >= item.audited) return `on all ${item.audited} devices`;
  if (n === 1) return `on the ${item.devices[0]} only`;
  return `on ${n} of ${item.audited} devices`;
}

// ── Grouping for the client ────────────────────────────────────────────────
//
// A tester reads "Tap target 80 × 14" three times and sees three elements to
// fix. A client reads it and sees noise. So the report groups by KIND: one
// entry per rule, saying how many elements it covers and how far it reaches,
// with the measurements underneath for whoever does the work.

export type ReportGroup = {
  rule: string;
  severity: "error" | "warn" | "info";
  /** Plain English, for someone who does not run the tests. */
  headline: string;
  check: string | null;
  /** Distinct elements this kind affects; 0 when it is about the whole page. */
  elements: number;
  devices: string[];
  audited: number;
  sample: ReportItem["sample"];
  /** The underlying findings, worst first — the evidence lines. */
  examples: ReportItem[];
};

// One per rule the audit can emit. Written as the thing a visitor experiences,
// not the thing the tool measured.
const HEADLINES: Record<string, string> = {
  overflow: "The page scrolls sideways",
  "element-wider": "Something is cut off at the edge of the screen",
  "tap-small": "Links and buttons too small to tap reliably",
  "tap-close": "Tap targets sit too close together",
  "clipped-text": "Text is cut off",
  "text-small": "Text too small to read on a phone",
  "fixed-chrome": "Fixed bars take up too much of the screen",
  "viewport-meta": "The page fights being zoomed",
  offscreen: "Content is parked off the side of the page",
  "image-size": "Photos are the wrong size for the screen",
  cls: "The page jumps while it loads",
  webfont: "A webfont did not load",
  "responsive-load": "The page did not finish loading",
};

/** The client-facing title for a kind of fault. Falls back to the tester's
 *  short label, so a rule added without a headline reads oddly rather than
 *  disappearing. */
export function groupHeadline(rule: string, examples: ReportItem[]): string {
  if (rule === "image-size") {
    const soft = examples.some((e) => /look soft/.test(e.message));
    const big = examples.some((e) => /Oversized|larger than/i.test(e.label));
    if (soft && !big) return "Photos will look soft on phones";
    if (big && !soft) return "Photos are larger than they need to be";
  }
  if (rule === "viewport-meta" && examples.some((e) => /^No viewport/.test(e.label))) {
    return "The page has no viewport tag, so phones guess at its width";
  }
  return HEADLINES[rule] ?? examples[0]?.label ?? rule;
}

/** One entry per kind of fault, worst first, then by how far it reaches. */
export function reportGroups(items: ReportItem[]): ReportGroup[] {
  const byRule = new Map<string, ReportItem[]>();
  for (const it of items) byRule.set(it.rule, [...(byRule.get(it.rule) ?? []), it]);

  const out: ReportGroup[] = [];
  for (const [rule, examples] of byRule) {
    const severity = examples.reduce<ReportItem["severity"]>((w, e) => (RANK[e.severity] < RANK[w] ? e.severity : w), "info");
    const devices: string[] = [];
    for (const e of examples) for (const d of e.devices) if (!devices.includes(d)) devices.push(d);
    const selectors = new Set(examples.filter((e) => !e.pageLevel && e.selector).map((e) => e.selector as string));
    const sample = examples.reduce<ReportItem["sample"]>(
      (best, e) => (e.sample && (!best || e.sample.box.y < best.box.y) ? e.sample : best), null);
    out.push({
      rule, severity, headline: groupHeadline(rule, examples),
      check: examples[0].check, elements: selectors.size,
      devices, audited: examples[0].audited, sample, examples,
    });
  }
  return out.sort((a, b) =>
    (RANK[a.severity] ?? 9) - (RANK[b.severity] ?? 9)
    || b.devices.length - a.devices.length
    || a.headline.localeCompare(b.headline));
}

export type GroupSplit = { blocking: ReportGroup[]; next: ReportGroup[]; notes: ReportGroup[] };

export function splitGroups(groups: ReportGroup[]): GroupSplit {
  return {
    blocking: groups.filter((g) => g.severity === "error"),
    next: groups.filter((g) => g.severity === "warn"),
    notes: groups.filter((g) => g.severity === "info"),
  };
}

/** "5 links, on 11 of 14 devices" — scope and reach in one line. */
export function groupScope(g: ReportGroup): string {
  const reach = g.devices.length >= g.audited ? `on all ${g.audited} devices`
    : g.devices.length === 1 ? `on the ${g.devices[0]} only`
    : `on ${g.devices.length} of ${g.audited} devices`;
  if (g.elements <= 1) return reach;
  return `${g.elements} elements, ${reach}`;
}
