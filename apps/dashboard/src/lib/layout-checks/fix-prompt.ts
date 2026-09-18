// THE WHOLE RUN, AS ONE INSTRUCTION.
//
// "Copy all" writes the findings out for a person to read — Slack, a ticket, an
// email. This writes the same findings out for whoever (or whatever) builds the
// page to act on in one pass: the page, the measurements, what each one costs a
// visitor, and the rules a fix has to respect. Most of these pages are built
// with an assistant, so the shortest path from "the tool found this" to "the
// page is fixed" is a prompt that can be pasted straight in.
//
// It is deliberately not chatty. Every line is either a measurement the tool
// actually took or a constraint on the fix; nothing is invented to fill it out,
// and the usual fix is offered as a starting point rather than an instruction,
// because the tool measures pages and does not know their source.
//
// Pure, so the wording is tested without a clipboard.

import { reachKey } from "@/lib/layout-checks/reach";

export type PromptFinding = {
  /** "Tap target 77 × 14". */
  label: string;
  /** The tool's own sentence, with the numbers in it. */
  message?: string;
  selector: string | null;
  pageLevel?: boolean;
  why?: string;
  fix?: string;
  severity?: "error" | "warn" | "info";
  /** "9 of 14 devices", where the run knows. */
  reach?: string | null;
  /** "new" this run, or "still" there from the last one. */
  since?: "new" | "still" | null;
  /** How it has behaved over the last runs (stability.ts) — a fixture is
   *  pressure, a flap is a warning not to chase it. */
  history?: string | null;
  /** The element's computed numbers as one line (numbers.ts), and its opening tag. */
  now?: string | null;
  html?: string | null;
};

export type PromptContext = {
  /** The page under test. */
  url: string;
  /** "Samsung Galaxy S25 · Chromium · 412 × 892", or "470px · Phone". */
  where: string;
};

const RULES = [
  "Change the smallest thing that makes each measurement pass. Copy, content and structure stay as they are unless the finding is about them.",
  "The same page is checked at other widths and on other devices: a fix for one must not break another.",
  "Each item gives what was measured and why it matters. The usual fix is a starting point, not an instruction — this came from measuring the rendered page, not from reading its source, so if the page needs something else, do that instead.",
  "If an item is deliberate and right as it is, leave it and say so.",
];

function block(f: PromptFinding, n: number): string {
  const lines = [`${n}. ${f.label}`];
  lines.push(`   Element: ${f.pageLevel ? "the page as a whole" : (f.selector ?? "not recorded")}`);
  if (f.message && f.message !== f.label) lines.push(`   Measured: ${f.message}`);
  if (f.now) lines.push(`   Now: ${f.now}`);
  if (f.html) lines.push(`   Tag: ${f.html}`);
  if (f.why) lines.push(`   Why it matters: ${f.why}`);
  if (f.fix) lines.push(`   Usual fix: ${f.fix}`);
  if (f.reach) lines.push(`   Seen on: ${f.reach}`);
  if (f.since === "new") lines.push("   Since: new this run");
  else if (f.since === "still") lines.push("   Since: reported on the last run too");
  if (f.history) lines.push(`   History: ${f.history}`);
  return lines.join("\n");
}

/**
 * The prompt, or "" when there is nothing to say — the button that copies this
 * is hidden in that case rather than offering an empty clipboard.
 */
export function fixPrompt(findings: PromptFinding[], ctx: PromptContext): string {
  const fix = findings.filter((f) => f.severity !== "info");
  const notes = findings.filter((f) => f.severity === "info");
  if (!fix.length && !notes.length) return "";

  const out: string[] = [];
  out.push(fix.length
    ? `This page was checked on real device sizes and ${fix.length === 1 ? "one thing needs" : `${fix.length} things need`} fixing.`
    : "This page was checked on real device sizes and nothing is failing. The notes below are for information.");
  out.push("");
  out.push(`Page: ${ctx.url}`);
  out.push(`Measured on: ${ctx.where}`);
  out.push("");

  if (fix.length) {
    out.push("How to fix:");
    for (const rule of RULES) out.push(`- ${rule}`);
    out.push("");
    out.push(fix.length === 1 ? "The finding:" : "The findings:");
    out.push("");
    fix.forEach((f, i) => { out.push(block(f, i + 1)); out.push(""); });
  }

  if (notes.length) {
    out.push("Also noted, not necessarily to fix:");
    out.push("");
    notes.forEach((f, i) => { out.push(block(f, i + 1)); out.push(""); });
  }

  if (fix.length) {
    out.push("When you are done, say which of these you changed and which you left, one line each.");
  }
  return out.join("\n").trimEnd() + "\n";
}

/** One device's findings, already shaped for the rail. */
export type DeviceItems = {
  /** "Samsung Galaxy S25" */
  device: string;
  items: {
    rule: string;
    label: string;
    message?: string;
    selector: string | null;
    pageLevel?: boolean;
    severity?: "error" | "warn" | "info";
  }[];
};

const RANK: Record<string, number> = { error: 0, warn: 1, info: 2 };

/**
 * Every device's findings as one list, the same fault counted once.
 *
 * A page is checked on fourteen devices and most faults appear on most of them,
 * so a per-device prompt asks for the same fix fourteen times — and whoever
 * reads it cannot tell the site-wide fault from the one that is only on an
 * iPhone. "The same fault" is the rule on the same selector, which is how the
 * rest of the tool identifies one (see reach.ts); the group keeps its worst
 * severity and says where it was seen.
 *
 * @param devices  the audited devices, in the order the picker shows them
 * @param help     why it matters and the usual fix, by rule
 */
export function mergePageFindings(
  devices: DeviceItems[],
  help?: (rule: string) => { why?: string; fix?: string } | null | undefined,
): PromptFinding[] {
  const audited = devices.length;
  const groups = new Map<string, { f: PromptFinding; on: string[] }>();
  for (const d of devices) {
    const seen = new Set<string>();
    for (const it of d.items) {
      const key = reachKey(it.rule, it.selector, it.pageLevel ? "page" : undefined);
      // A device counts once per fault however many rows it reported for it.
      const first = !seen.has(key);
      seen.add(key);
      const g = groups.get(key);
      if (!g) {
        const h = help?.(it.rule);
        groups.set(key, {
          f: { label: it.label, message: it.message, selector: it.selector, pageLevel: it.pageLevel,
               why: h?.why, fix: h?.fix, severity: it.severity },
          on: [d.device],
        });
        continue;
      }
      if (first) g.on.push(d.device);
      // Worst wins: a target that is an error on one device and a note on
      // another is an error, and it should read as the device that failed.
      if ((RANK[it.severity ?? "info"] ?? 9) < (RANK[g.f.severity ?? "info"] ?? 9)) {
        g.f = { ...g.f, label: it.label, message: it.message, severity: it.severity };
      }
    }
  }
  // Worst first, then the ones on the most devices: a fix that lands
  // everywhere is worth more than one that lands on a single handset.
  return [...groups.values()]
    .sort((a, b) => (RANK[a.f.severity ?? "info"] ?? 9) - (RANK[b.f.severity ?? "info"] ?? 9)
      || b.on.length - a.on.length
      || a.f.label.localeCompare(b.f.label))
    .map(({ f, on }) => ({
      ...f,
      reach: audited > 1 && on.length >= audited ? `all ${audited} devices`
        : on.length === 1 ? `only on ${on[0]}`
        : `${on.length} of ${audited} devices`,
    }));
}
