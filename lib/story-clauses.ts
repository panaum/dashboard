import type { Story } from "./living-certificate";

// LIVING CERTIFICATE — Section 4's one piece of logic, kept pure.
//
// Separated from StoryHeader.tsx so it can be tested with no renderer, no DOM
// and no build step — the same split the Dashboard uses for its shape modules.
//
// The rule this file exists to enforce: a null field is DROPPED, never rendered
// as 0 or "—". On a client-facing certificate an absent number must read as "we
// are not claiming anything here", not as a bad score. Until Section 1 wires
// LinkSpy, uptime / incidents are null and the line is just the delivery age.

export function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** The clauses a client sees, in order, with absent data simply not present. */
export function storyClauses(story: Story): string[] {
  const out: string[] = [];
  if (story.days_since_delivery !== null) {
    out.push(`${plural(story.days_since_delivery, "day", "days")} since delivery`);
  }
  if (story.uptime_pct !== null) out.push(`${story.uptime_pct}% uptime`);
  if (story.incidents_handled !== null) {
    out.push(`${plural(story.incidents_handled, "incident", "incidents")} handled`);
  }
  return out;
}
