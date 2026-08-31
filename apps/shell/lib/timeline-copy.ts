import type { TimelineEvent } from "./living-certificate";

// LIVING CERTIFICATE — Section 2's presentation rules, kept pure.
//
// The Dashboard owns the WORDING (its whitelist produces `title` and `detail`,
// and is the only place allowed to decide what a client may see). This file owns
// how those words are ORDERED and DATED — the two things a renderer can get
// wrong on its own.

/**
 * Newest first.
 *
 * LinkSpy already returns the ledger newest-first and the whitelist preserves
 * that order, so this is usually a no-op. It is done anyway because the section
 * makes a promise about chronology to the reader, and a section should be able
 * to keep its own promise without depending on an upstream ordering it does not
 * control. Sorting is stable, so events sharing a timestamp keep ledger order.
 *
 * Newest-first — matching Sections 1 and 3, which both lead with current state.
 * This is a living certificate: what is true now outranks what was true first.
 */
export function orderNewestFirst(events: TimelineEvent[]): TimelineEvent[] {
  return [...events].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/**
 * "28 July 2026", in UTC.
 *
 * Explicit rather than toLocaleDateString: the same string must come out of the
 * server and the browser, or React hydration mismatches and a client in Sydney
 * reads a different date from one in London. Matches the format the Dashboard's
 * /c/{shareId} certificate already uses.
 */
export function formatEventDate(iso: string): string | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/**
 * The empty state.
 *
 * Deliberately not "No events yet", which reads as a bug or an omission. The
 * ledger genuinely begins at delivery, so the sentence states a fact about the
 * timeline rather than an absence of data.
 *
 * Only ever shown for `timeline: []` — a successful look at an empty ledger.
 * A failed look sends `null` and the section does not render at all.
 */
export const TIMELINE_EMPTY_COPY = "Timeline begins after delivery.";
