// THIS RUN BESIDE THE LAST, ON THE SAME DEVICE.
//
// After a fix the question is not "what does the page look like now" but "is
// it different from before, and how". The Dashboard keeps the fold of the two
// most recent runs of every device, so for a device those two pictures can sit
// side by side — and the findings underneath can say, for this device alone,
// what went, what arrived and what stayed. The fleet-wide version of that
// sentence is run-diff.ts; this is the same arithmetic on one device, and the
// words that go with two dated pictures.
//
// Pure, so the wording is tested without a run.

import { reachKey } from "@/lib/layout-checks/reach";

export type RunDiff = {
  /** Reported last run, gone now. */
  fixed: string[];
  /** Reported now, not last run. */
  added: string[];
  /** Reported both times. */
  kept: string[];
};

type DeviceLike = { status: string; findings: { rule: string; selector?: string | null; scope?: string }[] };

/** A fault's identity is the one reach.ts uses: the rule on the same selector. */
function keys(d: DeviceLike): Set<string> {
  return new Set(d.findings.map((f) => reachKey(f.rule, f.selector, f.scope)));
}

/**
 * What changed on ONE device between the run being read and the last one.
 * Null when the last run has nothing for this device — it was not captured,
 * or the profile did not exist then — because "0 fixed · 0 new" would be a
 * claim about a comparison that did not happen.
 */
export function deviceChanges(cur: DeviceLike | null | undefined, prev: DeviceLike | null | undefined): RunDiff | null {
  if (!cur || !prev || cur.status !== "ok" || prev.status !== "ok") return null;
  const now = keys(cur), then = keys(prev);
  return {
    fixed: [...then].filter((k) => !now.has(k)),
    added: [...now].filter((k) => !then.has(k)),
    kept: [...now].filter((k) => then.has(k)),
  };
}

const n = (count: number, one: string, many = one) => `${count} ${count === 1 ? one : many}`;

/** The line under the two pictures. Says "nothing changed" out loud here,
 *  unlike the fleet line, because two identical pictures side by side need
 *  the tool to confirm that it looked. */
export function beforeAfterLine(diff: RunDiff | null | undefined): string {
  if (!diff) return "The last run has no capture of this device to compare with.";
  if (!diff.fixed.length && !diff.added.length) {
    return diff.kept.length
      ? `Nothing changed on this device: ${n(diff.kept.length, "finding", "findings")} then, the same ${diff.kept.length === 1 ? "one" : "ones"} now.`
      : "Nothing changed on this device: clean then, clean now.";
  }
  const parts: string[] = [];
  if (diff.fixed.length) parts.push(n(diff.fixed.length, "fixed"));
  if (diff.added.length) parts.push(n(diff.added.length, "new"));
  if (diff.kept.length) parts.push(`${diff.kept.length} still there`);
  return `On this device since the last run: ${parts.join(" · ")}`;
}

/** "16 Sep, 05:22" — the date a picture was taken, short enough for a caption. */
export function whenWords(iso: string, locale = "en-GB"): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(locale, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}
