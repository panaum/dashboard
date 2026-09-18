// HOW LONG A FINDING HAS BEEN THERE — AND WHETHER IT STAYS.
//
// The rail shows one run. A fault that has been in every run since the eighth
// is a fixture nobody has got to; a fault that appears in two runs out of six
// is a flap — a lazy image that sometimes lands before the shutter, a carousel
// caught mid-slide — and chasing it wastes a developer's afternoon. Both look
// identical in a single run. The Dashboard keeps twelve runs of findings for
// every site, so the difference is computable, and this computes it.
//
// A finding's identity is the one reach.ts uses: the rule on the same
// selector, or the rule alone for a page-level rule. Pure, so every rule is
// tested without a run.

import { reachKey } from "@/lib/layout-checks/reach";

export type Stability = {
  /** Runs, newest first, that this fault appeared in — 1 means this run only. */
  seen: number;
  /** Runs considered, newest first, capped at the window. */
  of: number;
  /** ISO date of the OLDEST run in the window that carried it — the start of
   *  its unbroken streak from now, if it has one. */
  since: string | null;
  /** In every run of the window: a fixture. */
  persistent: boolean;
  /** Present in this run, absent in the one before, present before that — or
   *  the mirror: it comes and goes. */
  flapping: boolean;
};

/** How many runs back to look. The page loads twelve; six is enough to tell
 *  a fixture from a flap, and a fault older than six runs is old enough. */
export const WINDOW = 6;

type DeviceLike = { status: string; findings: { rule: string; selector?: string | null; scope?: string }[] };
type ViewportLike = { id: string; status: string };

export type RunKeys = { checkedAt: string; keys: Set<string> };

/** One device run → the set of faults it reported across its audited devices. */
export function deviceRunKeys(checkedAt: string, devices: DeviceLike[]): RunKeys {
  const keys = new Set<string>();
  for (const d of devices) {
    if (d.status !== "ok") continue;
    for (const f of d.findings) keys.add(reachKey(f.rule, f.selector, f.scope));
  }
  return { checkedAt, keys };
}

/** One Viewports run → the rules that were FAIL or WARN. */
export function viewportRunKeys(checkedAt: string, findings: ViewportLike[]): RunKeys {
  return { checkedAt, keys: new Set(findings.filter((f) => f.status === "FAIL" || f.status === "WARN").map((f) => f.id)) };
}

/**
 * @param key   the fault, as reach.ts keys it
 * @param runs  the runs newest first, this run first; only the first WINDOW count
 */
export function stabilityOf(key: string, runs: RunKeys[], window = WINDOW): Stability | null {
  const look = runs.slice(0, window);
  if (look.length < 2) return null;             // one run says nothing about time
  const present = look.map((r) => r.keys.has(key));
  if (!present[0]) return null;                 // not in this run: nothing to mark
  const seen = present.filter(Boolean).length;
  // The unbroken streak from now, and the date at its far end.
  let streak = 0;
  while (streak < present.length && present[streak]) streak++;
  const since = look[streak - 1].checkedAt;
  const persistent = seen === look.length;
  // A flap is any gap inside the window: present, absent, present.
  const flapping = present.slice(streak).includes(true);
  return { seen, of: look.length, since, persistent, flapping };
}

/** "16 Sep" — a date short enough for a chip. */
function day(iso: string, locale = "en-GB"): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString(locale, { day: "numeric", month: "short" });
}

/**
 * The chip, or null when there is nothing worth a chip: a fault seen in this
 * run and the last and nothing else is ordinary, and "2 of 2" says nothing.
 */
export function stabilityWords(s: Stability | null | undefined): string | null {
  if (!s) return null;
  if (s.flapping) return `comes and goes — ${s.seen} of the last ${s.of} runs`;
  if (s.persistent && s.of >= 3) return `in every run since ${day(s.since ?? "")}`.trimEnd();
  return null;
}

/** For the fix prompt, where a longer line is fine and pressure is the point. */
export function stabilitySentence(s: Stability | null | undefined): string | null {
  if (!s) return null;
  if (s.flapping) return `Comes and goes: seen in ${s.seen} of the last ${s.of} runs. Confirm it against the screenshot before spending time on it.`;
  if (s.persistent && s.of >= 3) return `In every one of the last ${s.of} runs, since ${day(s.since ?? "")}.`;
  if (s.seen >= 2) return `Reported on the last run too.`;
  return null;
}
