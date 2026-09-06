// LAYOUT HISTORY — comparing one run of a page against the run before it.
// Pure: no I/O, no React, no Prisma.
//
// The question this answers is not "is the page broken" but "did the thing I
// asked the developer to fix actually get fixed, and did fixing it break
// something else". Those are different questions and the second one is the one
// people forget to ask.

import type { ResponsiveFinding } from "./responsive-view";

export type RunSummary = {
  checkedAt: string;
  findings: ResponsiveFinding[];
};

export type Movement = "fixed" | "introduced" | "still-open" | "unchanged";

export type FindingChange = {
  id: string;
  title: string;
  movement: Movement;
  before: ResponsiveFinding["status"] | null;
  after: ResponsiveFinding["status"] | null;
  detail?: string;
};

const BAD: ReadonlySet<string> = new Set(["FAIL", "WARN"]);

/** SKIP means "could not verify" — it is neither a pass nor a problem, so it
 *  can never count as a fix. A page that stopped loading has not been repaired. */
const UNKNOWN: ReadonlySet<string> = new Set(["SKIP"]);

export function diffRuns(previous: RunSummary | null, current: RunSummary): FindingChange[] {
  const before = new Map((previous?.findings ?? []).map((f) => [f.id, f]));
  const after = new Map(current.findings.map((f) => [f.id, f]));
  const ids = [...new Set([...before.keys(), ...after.keys()])];
  const out: FindingChange[] = [];

  for (const id of ids) {
    const b = before.get(id);
    const a = after.get(id);
    const bBad = !!b && BAD.has(b.status);
    const aBad = !!a && BAD.has(a.status);
    const aUnknown = !!a && UNKNOWN.has(a.status);

    let movement: Movement;
    if (bBad && aBad) movement = "still-open";
    else if (bBad && !aBad) movement = aUnknown ? "still-open" : "fixed";
    else if (!bBad && aBad) movement = previous ? "introduced" : "still-open";
    else movement = "unchanged";

    out.push({
      id,
      title: a?.title ?? b?.title ?? id,
      movement,
      before: b?.status ?? null,
      after: a?.status ?? null,
      detail: a?.detail ?? b?.detail,
    });
  }
  // Regressions first: a fix that broke something else is the thing to see.
  const rank: Record<Movement, number> = {
    introduced: 0, "still-open": 1, fixed: 2, unchanged: 3,
  };
  return out.sort((x, y) => rank[x.movement] - rank[y.movement] || x.id.localeCompare(y.id));
}

export type HistoryVerdict = {
  fixed: number;
  introduced: number;
  stillOpen: number;
  headline: string;
  tone: "success" | "warning" | "error" | "neutral";
};

/** One sentence for someone who asked a developer for a fix and wants to know
 *  whether to accept it. */
export function verdictOf(changes: FindingChange[], hasPrevious: boolean): HistoryVerdict {
  const fixed = changes.filter((c) => c.movement === "fixed").length;
  const introduced = changes.filter((c) => c.movement === "introduced").length;
  const stillOpen = changes.filter((c) => c.movement === "still-open").length;

  if (!hasPrevious) {
    return {
      fixed, introduced, stillOpen,
      headline: stillOpen
        ? `First check — ${stillOpen} thing${stillOpen > 1 ? "s" : ""} to look at.`
        : "First check — nothing to look at.",
      tone: stillOpen ? "warning" : "success",
    };
  }
  if (introduced) {
    return {
      fixed, introduced, stillOpen,
      headline: `${introduced} new problem${introduced > 1 ? "s" : ""} since the last check`
        + (fixed ? `, though ${fixed} ${fixed > 1 ? "were" : "was"} fixed.` : "."),
      tone: "error",
    };
  }
  if (fixed && !stillOpen) {
    return {
      fixed, introduced, stillOpen,
      headline: `${fixed} fixed, nothing left open.`,
      tone: "success",
    };
  }
  if (fixed) {
    return {
      fixed, introduced, stillOpen,
      headline: `${fixed} fixed, ${stillOpen} still open.`,
      tone: "warning",
    };
  }
  if (stillOpen) {
    return {
      fixed, introduced, stillOpen,
      headline: `Nothing changed — ${stillOpen} still open.`,
      tone: "warning",
    };
  }
  return { fixed, introduced, stillOpen, headline: "No change, still clean.", tone: "success" };
}
