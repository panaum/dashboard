// The site Overview's presentation rules. Pure — no React, no clock, no fetch —
// so every rule below is unit tested rather than eyeballed in a screenshot.
//
// The page's job is making a red state impossible to miss. Nine equal tiles
// cannot do that, so severity decides three separate things here: the order,
// the size, and whether a card is shown at all.

import { roleOf, type CheckRole } from "./check-roles";
import type { VitalCard, VitalCheck, VitalEscalation } from "./sites-view";

export const SEVERITY_RANK: Record<VitalEscalation, number> = {
  critical: 0,
  warn: 1,
  notice: 2,
  unknown: 3,
  ok: 4,
};

/** Worst first, always. Never alphabetical, never by category. */
export function sortBySeverity(cards: VitalCard[]): VitalCard[] {
  return [...cards].sort(
    (a, b) => (SEVERITY_RANK[a.escalation] ?? 9) - (SEVERITY_RANK[b.escalation] ?? 9),
  );
}

/**
 * Cards that need reading, and cards that only need reassuring.
 *
 * `unknown` stays with the attention group on purpose: "we could not check
 * this" is not a pass, and folding it into a green strip would claim a result
 * nobody established.
 */
export function partitionCards(cards: VitalCard[]): {
  attention: VitalCard[];
  passing: VitalCard[];
} {
  const sorted = sortBySeverity(cards);
  return {
    attention: sorted.filter((c) => c.escalation !== "ok"),
    passing: sorted.filter((c) => c.escalation === "ok"),
  };
}

const BAD: VitalEscalation[] = ["critical", "warn", "notice"];

/** The findings inside a card, worst first. Empty for a passing card. */
export function badChecks(card: VitalCard): VitalCheck[] {
  return [...(card.checks ?? [])]
    .filter((c) => BAD.includes(c.status))
    .sort((a, b) => (SEVERITY_RANK[a.status] ?? 9) - (SEVERITY_RANK[b.status] ?? 9));
}

/**
 * What the card says under its value.
 *
 * The old line truncated a joined string mid-word — "SPF: 2 records —
 * receivers reject that · DM…" cuts off exactly where the second problem
 * starts, and half a sentence is worse than a count. So: the count, and the
 * worst one in full. The rest is behind the card.
 */
export function cardSummary(card: VitalCard): { count: number; worst: string | null } {
  const bad = badChecks(card);
  return { count: bad.length, worst: bad[0]?.text ?? null };
}

const plural = (n: number, one: string, many = one + "s") => `${n} ${n === 1 ? one : many}`;

export type Verdict = {
  headline: string;
  tone: "success" | "warning" | "error" | "neutral";
  /** The one finding worth naming, with its remedy. Null when all clear. */
  urgent: string | null;
};

/**
 * One line, read in two seconds, in the same voice as the Layout checks
 * report. Counts, then the single most urgent thing named underneath —
 * because "2 critical" tells you to look and "Email is the urgent one" tells
 * you where.
 */
export function overviewVerdict(cards: VitalCard[]): Verdict {
  if (!cards.length) return { headline: "No checks have run yet.", tone: "neutral", urgent: null };

  const critical = cards.filter((c) => c.escalation === "critical").length;
  const warnings = cards.filter((c) => c.escalation === "warn").length;
  const unknown = cards.filter((c) => c.escalation === "unknown").length;
  const total = cards.length;

  if (!critical && !warnings && !unknown) {
    return { headline: `All ${total} checks passing`, tone: "success", urgent: null };
  }

  const parts: string[] = [];
  if (critical) parts.push(`${critical} critical`);
  if (warnings) parts.push(plural(warnings, "warning"));
  if (unknown) parts.push(`${unknown} not established`);

  const [worst] = sortBySeverity(cards.filter((c) => c.escalation !== "ok"));
  const finding = worst ? badChecks(worst)[0] : undefined;
  const remedy = finding ? remedyFor(finding.text) : null;
  // Two sentences, not one run-on: what is wrong, then what to do about it.
  let urgent: string | null = null;
  if (worst) {
    const named = finding ? `: ${lower(finding.text)}` : "";
    const stop = named && !/[.!?]$/.test(finding!.text) ? "." : "";
    urgent = `${worst.label} is the urgent one${named}${stop}` + (remedy ? ` ${remedy}` : "");
    if (!named && !remedy) urgent += ".";
  }

  return {
    headline: `${parts.join(" · ")} across ${total} checks`,
    tone: critical ? "error" : warnings ? "warning" : "neutral",
    urgent,
  };
}

/** Lower-case the first letter so the finding reads as part of the sentence —
 *  but never an acronym. "SPF: none" must not become "sPF: none". */
function lower(text: string): string {
  const first = text.slice(0, 2);
  if (first === first.toUpperCase() && /[A-Z]{2}/.test(first)) return text;
  return text.charAt(0).toLowerCase() + text.slice(1);
}

// ── Remedies ────────────────────────────────────────────────────────────────
//
// "HSTS: missing" assumes the reader knows what HSTS is and how to add one. A
// finding says something is wrong; a remedy lets someone act. One sentence,
// plain language, no jargon that needs its own search.
//
// Keyed on the stable part of the check text — the backend writes
// "<subject>: <state>", so the subject is the key. Anything unrecognised gets
// no remedy rather than a guessed one.

const REMEDIES: Array<[RegExp, string]> = [
  [/^spf:\s*none/i, "Publish an SPF record naming the servers allowed to send your mail."],
  [/^spf:\s*\d+\s*records?/i, "Merge them into a single record — receivers reject a domain with two."],
  [/^spf:/i, "Check the SPF record lists every service that sends your mail."],
  [/^dmarc:\s*p=none/i, "Move the policy to quarantine once the reports look clean."],
  [/^dmarc:\s*(none|missing)/i, "Add a DMARC record so receivers know what to do with failures."],
  [/^dkim:/i, "Turn on DKIM signing with each service that sends your mail."],
  [/^hsts:/i, "Add a Strict-Transport-Security response header."],
  [/^csp:/i, "Add a Content-Security-Policy header, starting in report-only mode."],
  [/^x-content-type-options:/i, "Add the header X-Content-Type-Options: nosniff."],
  [/^clickjacking:/i, "Add frame-ancestors to your Content-Security-Policy so other sites cannot embed yours."],
  [/^referrer-policy:/i, "Add a Referrer-Policy header — strict-origin-when-cross-origin suits most sites."],
  [/^meta description:.*long/i, "Trim it to about 155 characters so it isn't cut off in results."],
  [/^meta description:.*(missing|none)/i, "Write a one-sentence description of the page for search results."],
  [/^title:/i, "Give the page a title of roughly 50 to 60 characters."],
  [/^headings:/i, "Use heading levels in order — don't jump from h2 to h4."],
  [/^form fields:/i, "Add a <label> or aria-label to each unlabelled field."],
  [/^images:/i, "Add alt text describing what each image shows."],
  [/^landmarks?:/i, "Wrap the page in <main>, <nav> and <header> so screen readers can skip about."],
  [/^language:/i, "Set lang on the <html> element."],
  [/noindex/i, "Remove the noindex directive — it is telling search engines not to list this page."],
  [/robots\.txt is blocking/i, "Remove the site-wide Disallow so search engines can crawl the pages you want listed."],
  [/^sitemap/i, "Publish a sitemap.xml and reference it from robots.txt."],
  [/nameserver|address \(a\/aaaa\)|mx record/i, "Confirm the change was planned — DNS moving unexpectedly is worth a phone call."],
];

/** One sentence of remedy, or null when we have nothing honest to say. */
export function remedyFor(text: string): string | null {
  const t = (text ?? "").trim();
  if (!t) return null;
  for (const [pattern, remedy] of REMEDIES) {
    if (pattern.test(t)) return remedy;
  }
  return null;
}

/** "SSL 31 days · Domain 309 days · Uptime 99.9%" — the passing strip. */
export function passingSummary(cards: VitalCard[]): Array<{ label: string; fact: string }> {
  return cards.map((c) => ({ label: c.label, fact: c.fact }));
}


// ─── The findings list ──────────────────────────────────────────────────────
//
// The page used to show our taxonomy of checkers, one box each, and left the
// reader to assemble the verdict from nine tiles. What someone actually wants
// is the work: one list, worst first, in plain words, with what to do about it.
//
// The card is where a finding CAME from, not what it is. It survives as a
// quiet label on the row, because "SPF: none" means more next to the word
// Email than on its own.

export type Finding = {
  /** Stable within a render — the card key plus the check key. */
  id: string;
  cardKey: string;
  cardLabel: string;
  checkKey: string | null;
  status: VitalEscalation;
  text: string;
  remedy: string | null;
  /** Null when this build has no agreed arrangement for the check key. */
  role: CheckRole | null;
};

/** Every finding on the site, worst first, flattened out of the cards. */
export function findingsOf(cards: VitalCard[]): Finding[] {
  const out: Finding[] = [];
  for (const card of sortBySeverity(cards)) {
    for (const check of badChecks(card)) {
      out.push({
        id: `${card.key}:${check.key ?? check.text}`,
        cardKey: card.key,
        cardLabel: card.label,
        checkKey: check.key ?? null,
        status: check.status,
        text: check.text,
        remedy: remedyFor(check.text),
        role: roleOf(check.key),
      });
    }
  }
  return out.sort(
    (a, b) => (SEVERITY_RANK[a.status] ?? 9) - (SEVERITY_RANK[b.status] ?? 9),
  );
}

/**
 * The header number: a count of work, not a count of checks.
 *
 * "1 critical · 2 warnings across 9 checks" is an audit statistic. "11 to fix"
 * is a fact about somebody's afternoon, and it is the one the reader wants.
 */
export function workCount(cards: VitalCard[]): number {
  return findingsOf(cards).length;
}

/** Cards we could not read. Never folded in with the passing ones. */
export function unknownCards(cards: VitalCard[]): VitalCard[] {
  return cards.filter((c) => c.escalation === "unknown");
}

/** "SSL, domain, uptime and DNS all fine" — one reassuring line, not a row. */
export function passingLine(cards: VitalCard[]): string | null {
  // lower() keeps acronyms: "SSL, domain, search visibility, uptime and DNS",
  // never "Ssl ... dns". Same rule as the verdict line.
  const names = cards
    .filter((c) => c.escalation === "ok")
    .map((c) => lower(c.label));
  if (!names.length) return null;
  const listed =
    names.length === 1
      ? names[0]
      : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  const verb = names.length === 1 ? "is" : "are";
  // Only sentence-case the opening word when it is not an acronym.
  const opening = /^[A-Z]{2}/.test(listed) ? listed
    : `${listed[0].toUpperCase()}${listed.slice(1)}`;
  return `${opening} ${verb} all fine`;
}


/**
 * Findings split by where the fix lives.
 *
 * `page` means the fault is in the page's own markup or copy — NOT that we
 * know where on the page. No sentinel check records a selector (#170), so the
 * heading claims nothing more than that. A finding whose check key this build
 * has no arrangement for is kept separate rather than guessed into a group.
 */
export function bySurface(findings: Finding[]): {
  page: Finding[];
  infrastructure: Finding[];
  unclassified: Finding[];
} {
  return {
    page: findings.filter((f) => f.role?.surface === "page"),
    infrastructure: findings.filter((f) => f.role?.surface === "infrastructure"),
    unclassified: findings.filter((f) => !f.role),
  };
}
