// Apexure Quality Score — one explainable 0–100 number per deliverable.
//
// Pure and deterministic (no clock reads): it derives entirely from stored data
// — checklist results, open issues, on-time delivery, and the certificate verdict
// — so it unit-tests without a DB and matches the project's insights.ts style.
// Reused by the client portal, the embeddable trust badge, and the certificate.

import { SEVERITIES, type Severity, type Tone } from "@/lib/constants";

export type ScoreInput = {
  /** Certificate verdict: "PASS" | "FAIL" | "IN_PROGRESS" | null. */
  certStatus: string | null | undefined;
  /** Checklist items — only `result` matters here. */
  items: { result: string | null }[];
  /** Issues with severity + status (OPEN penalises; FIXED is forgiven). */
  issues: { severity: string; status: string }[];
  /** Stored integer delay in days (0 = on time). */
  delayDays: number;
};

export type ScoreBand = "excellent" | "good" | "fair" | "poor" | "pending";

export type QualityScore = {
  /** 0–100, rounded. */
  score: number;
  band: ScoreBand;
  label: string;
  tone: Tone;
  /** True when there's nothing graded yet — score is provisional. */
  provisional: boolean;
  /** Plain-language reasons, strongest first — fuels the "explainable" UI. */
  factors: string[];
};

// How much each open issue subtracts. Repetitive bugs are weighted heavily —
// they signal a process gap, which the insights module already treats as a
// first-class quality signal.
const ISSUE_PENALTY: Record<Severity, number> = {
  CRITICAL_HIGH: 14,
  REPETITIVE: 9,
  MEDIUM: 5,
  LOW: 2,
};

const ISSUE_PENALTY_CAP = 45; // open issues alone can't sink a page below this
const CHECKLIST_WEIGHT = 40; // max points the checklist fail-rate can remove
const DELAY_CAP = 15; // max points lost to lateness

function band(score: number): { band: ScoreBand; label: string; tone: Tone } {
  if (score >= 90) return { band: "excellent", label: "Excellent", tone: "success" };
  if (score >= 75) return { band: "good", label: "Good", tone: "success" };
  if (score >= 55) return { band: "fair", label: "Fair", tone: "warning" };
  return { band: "poor", label: "Needs work", tone: "error" };
}

/** Compute the Quality Score for a single page. Pure — safe to call anywhere. */
export function scorePage(input: ScoreInput): QualityScore {
  const graded = input.items.filter(
    (i) => i.result === "PASSED" || i.result === "FAILED",
  );
  const failed = graded.filter((i) => i.result === "FAILED").length;
  const openIssues = input.issues.filter((i) => i.status === "OPEN");

  // Nothing graded and no issues yet → provisional, don't pretend it's perfect.
  const provisional = graded.length === 0 && input.certStatus !== "PASS";

  let score = 100;
  const factors: string[] = [];

  // 1) Checklist fail-rate (the core signal).
  if (graded.length > 0) {
    const failRate = failed / graded.length;
    const lost = Math.round(failRate * CHECKLIST_WEIGHT);
    if (lost > 0) {
      score -= lost;
      factors.push(
        `${failed} of ${graded.length} checks failed (−${lost})`,
      );
    } else {
      factors.push(`All ${graded.length} graded checks passed`);
    }
  }

  // 2) Open issues, weighted by severity, capped so they can't dominate alone.
  if (openIssues.length > 0) {
    let issueLost = 0;
    for (const s of SEVERITIES) {
      const n = openIssues.filter((i) => i.severity === s).length;
      issueLost += n * ISSUE_PENALTY[s];
    }
    issueLost = Math.min(issueLost, ISSUE_PENALTY_CAP);
    score -= issueLost;
    factors.push(
      `${openIssues.length} open issue${openIssues.length === 1 ? "" : "s"} (−${issueLost})`,
    );
  } else {
    factors.push("No open issues");
  }

  // 3) Lateness. delayDays is a stored integer — no clock math.
  if (input.delayDays > 0) {
    const lost = Math.min(DELAY_CAP, Math.round(input.delayDays * 1.5));
    score -= lost;
    factors.push(
      `Delivered ${input.delayDays} day${input.delayDays === 1 ? "" : "s"} late (−${lost})`,
    );
  } else {
    factors.push("Delivered on time");
  }

  // 4) Verdict guardrails — a failed certificate can't read as high quality;
  //    a signed-off pass shouldn't sit below a respectable floor.
  if (input.certStatus === "FAIL") {
    score = Math.min(score, 55);
  } else if (input.certStatus === "PASS") {
    score = Math.max(score, 60);
  }

  score = Math.max(0, Math.min(100, Math.round(score)));

  if (provisional) {
    return {
      score,
      band: "pending",
      label: "In review",
      tone: "neutral",
      provisional: true,
      factors: ["Quality assurance in progress"],
    };
  }

  const b = band(score);
  return { score, ...b, provisional: false, factors };
}

/** Roll a set of per-page scores into one client-level score (simple mean). */
export function aggregateScore(scores: QualityScore[]): QualityScore {
  const graded = scores.filter((s) => !s.provisional);
  if (graded.length === 0) {
    return {
      score: 0,
      band: "pending",
      label: "In review",
      tone: "neutral",
      provisional: true,
      factors: ["Quality assurance in progress"],
    };
  }
  const mean = Math.round(
    graded.reduce((sum, s) => sum + s.score, 0) / graded.length,
  );
  const b = band(mean);
  return {
    score: mean,
    ...b,
    provisional: false,
    factors: [`Average across ${graded.length} reviewed deliverable${graded.length === 1 ? "" : "s"}`],
  };
}
