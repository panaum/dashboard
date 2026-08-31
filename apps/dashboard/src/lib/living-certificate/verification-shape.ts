// LIVING CERTIFICATE — Section 3, the continuous verification counters.
//
//   "38 of 39 checks holding · 1 needs attention · last checked 7 days ago"
//
// Pure: no I/O, no React, no clock read — `now` is injected, so the relative
// time is deterministic and testable.
//
// ═══ WHY THIS CAN RETURN null ═══
// Real data has three shapes, and one of them must not be rendered:
//
//   Fautons LP            39 items · 38 passed · 1 failed   → "38 of 39 holding"
//   24 Hours AR HubSpot   38 items · 21 passed · 17 failed  → "21 of 38 holding"
//   5-Day Metabolic       38 items · 0 passed · 38 N/A      → NOTHING
//
// The third is not a bad score, it is an ungraded checklist — QA was tracked at
// the verdict level, not per check (CLAUDE.md). Rendering "0 checks holding" on
// that client's certificate would state something false and alarming. When
// nothing has been graded there is no honest counter to show, so this returns
// null and the section disappears.

export type VerificationSource = {
  /** QACheckItem results for the page's certificate. */
  items: { result: string | null }[];
  /**
   * LinkSpyStatus.fetchedAt — when the Dashboard last pulled LinkSpy's live
   * status for this page. Read from our OWN database (no LinkSpy call, no
   * write). Null when the page was never linked or never fetched.
   *
   * ⚠ This is "when we last checked", not LinkSpy's own verification instant.
   * Section 1 replaces it with the authoritative `as_of` from qa-bridge/status.
   * The copy says "last checked" for exactly that reason.
   */
  lastCheckedAt: Date | null;
};

export type Verification = {
  total: number;
  holding: number;
  needs_attention: number;
  /** ISO, or null when we have never checked. */
  last_checked_at: string | null;
};

function isUsableDate(d: Date | null | undefined): d is Date {
  return d instanceof Date && !Number.isNaN(d.getTime());
}

/**
 * Build the counters, or null when there is nothing truthful to report.
 *
 * Null when: the page has no certificate items, or none of them have been
 * graded (every item N/A or unset).
 */
export function buildVerification(
  src: VerificationSource,
  _now: Date,
): Verification | null {
  const items = Array.isArray(src.items) ? src.items : [];
  const holding = items.filter((i) => i.result === "PASSED").length;
  const needsAttention = items.filter((i) => i.result === "FAILED").length;

  // Nothing graded ⇒ no honest counter exists. See the header comment.
  if (holding + needsAttention === 0) return null;

  return {
    total: items.length,
    holding,
    needs_attention: needsAttention,
    last_checked_at: isUsableDate(src.lastCheckedAt)
      ? src.lastCheckedAt.toISOString()
      : null,
  };
}
