import type { Story } from "./living-certificate";

// LIVING CERTIFICATE — Section 4's one piece of logic, kept pure.
//
// Separated from StoryHeader.tsx so it can be tested with no renderer, no DOM
// and no build step — the same split the Dashboard uses for its shape modules.
//
// ═══ TWO RULES THIS FILE EXISTS TO ENFORCE ═══
//
// 1. A null field is DROPPED, never rendered as 0 or "—". On a client-facing
//    certificate an absent number must read as "we are not claiming anything
//    here", not as a bad score.
//
// 2. Every live figure NAMES ITS SCOPE. These describe the SITE this page is
//    published on — not the page alone, and never the client's other properties
//    (F11: a page-level share token must not reveal a client's estate). A figure
//    sitting directly under the page's own name would otherwise read as the
//    page's figure, so the qualifier goes on each clause AND in a scope sentence.
//    The sentence alone is missable; the per-clause word alone reads as noise.

export function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** The clauses a client sees, in order, with absent data simply not present. */
export function storyClauses(story: Story): string[] {
  const out: string[] = [];
  // Page-level and from our own database — accurate without a qualifier.
  if (story.days_since_delivery !== null) {
    out.push(`${plural(story.days_since_delivery, "day", "days")} since delivery`);
  }
  // Site-level. The word "site" is load-bearing, not decoration.
  if (story.site_uptime_pct !== null) out.push(`${story.site_uptime_pct}% site uptime`);
  if (story.site_incidents_handled !== null) {
    out.push(`${plural(story.site_incidents_handled, "site incident", "site incidents")} handled`);
  }
  return out;
}

/**
 * The one sentence that fixes the scope, rendered whenever any site-level figure
 * is shown. Null when nothing site-level is on the page — an unqualified
 * sentence about a site we are not describing would be its own small confusion.
 */
export function scopeNote(story: Story): string | null {
  const hasSiteFigure =
    story.site_uptime_pct !== null ||
    story.site_incidents_handled !== null ||
    story.site_health !== null;
  return hasSiteFigure ? "Live figures cover the site this page is published on." : null;
}
