/**
 * "Needs attention" — pure, deterministic triage of deliverables.
 *
 * Like insights.ts: no DB, no React, no `Date`. Every signal is derived from
 * stored data (status, delayDays, certificate result, issues) so the same input
 * always yields the same flags and it's unit-testable without a clock.
 */

import { scorePage } from "@/lib/quality-score";
import type { Tone } from "@/lib/constants";

const LATE_THRESHOLD = 5; // days late before we flag it
const LOW_SCORE = 55; // quality score below this is "needs work"

export type AttentionInput = {
  id: string;
  name: string;
  status: string;
  delayDays: number;
  hasDeveloper: boolean;
  hasTester: boolean;
  certStatus: string | null;
  items: { result: string | null }[];
  issues: { severity: string; status: string }[];
  clientId: string;
  clientName: string;
  projectId: string;
};

export type AttentionReason = {
  kind: string;
  label: string;
  tone: Tone;
  weight: number;
};

export type AttentionItem = {
  id: string;
  name: string;
  clientName: string;
  href: string;
  reasons: AttentionReason[];
  weight: number;
};

export type Attention = {
  items: AttentionItem[];
  total: number;
  byKind: Record<string, number>;
};

function reasonsFor(p: AttentionInput): AttentionReason[] {
  const out: AttentionReason[] = [];
  const openIssues = p.issues.filter((i) => i.status === "OPEN");
  const openCritical = openIssues.filter((i) => i.severity === "CRITICAL_HIGH").length;
  const openRepeat = openIssues.filter((i) => i.severity === "REPETITIVE").length;
  const failedChecks = p.items.filter((i) => i.result === "FAILED").length;

  // Highest risk: a page is marked Live but its certificate never passed QA.
  if (p.status === "LIVE" && p.certStatus !== "PASS") {
    out.push({ kind: "LIVE_NO_SIGNOFF", label: "Live without QA sign-off", tone: "error", weight: 100 });
  }
  if (openCritical > 0) {
    out.push({
      kind: "OPEN_CRITICAL",
      label: `${openCritical} critical issue${openCritical === 1 ? "" : "s"} open`,
      tone: "error",
      weight: 90,
    });
  }
  if (p.certStatus === "FAIL" || failedChecks > 0) {
    out.push({
      kind: "QA_FAILING",
      label: failedChecks > 0 ? `${failedChecks} QA check${failedChecks === 1 ? "" : "s"} failing` : "QA failed",
      tone: "error",
      weight: 70,
    });
  }
  if (p.delayDays >= LATE_THRESHOLD) {
    out.push({ kind: "LATE", label: `${p.delayDays} days late`, tone: "warning", weight: 60 });
  }
  if (openRepeat > 0) {
    out.push({ kind: "REPEAT", label: "Repeat bug pattern", tone: "brand", weight: 50 });
  }
  if (!p.hasDeveloper || !p.hasTester) {
    const missing = !p.hasDeveloper && !p.hasTester ? "developer & tester" : !p.hasDeveloper ? "developer" : "tester";
    out.push({ kind: "UNASSIGNED", label: `No ${missing} assigned`, tone: "warning", weight: 40 });
  }

  const score = scorePage({
    certStatus: p.certStatus,
    items: p.items,
    issues: p.issues,
    delayDays: p.delayDays,
  });
  if (!score.provisional && score.score < LOW_SCORE) {
    out.push({ kind: "LOW_SCORE", label: `Quality score ${score.score}`, tone: "error", weight: 45 });
  }

  return out.sort((a, b) => b.weight - a.weight);
}

/** Flag deliverables that need action, ranked by urgency. */
export function buildAttention(pages: AttentionInput[]): Attention {
  const byKind: Record<string, number> = {};
  const items: AttentionItem[] = [];

  for (const p of pages) {
    const reasons = reasonsFor(p);
    if (reasons.length === 0) continue;
    for (const r of reasons) byKind[r.kind] = (byKind[r.kind] ?? 0) + 1;
    items.push({
      id: p.id,
      name: p.name,
      clientName: p.clientName,
      href: `/dashboard/clients/${p.clientId}/${p.projectId}/${p.id}`,
      reasons,
      weight: reasons[0].weight,
    });
  }

  // Most urgent first; ties broken by how many things are wrong.
  items.sort((a, b) => b.weight - a.weight || b.reasons.length - a.reasons.length);

  return { items, total: items.length, byKind };
}
