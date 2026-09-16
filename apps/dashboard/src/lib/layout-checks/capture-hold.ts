// Where a full-page capture stops, and how to say so.
//
// One screenshot is one image, and an image cannot be taller than 32,767
// pixels — a limit in the browsers' own graphics layer, not a setting of ours.
// At 3x that is 10,919 CSS px of page: a 19,588px page stops a little past
// halfway, and the frame simply ends there. devicepreview measures every
// finding from the DOM whatever the image can hold, and says so in the run's
// notes; this puts the same fact where the reader is looking at the capture,
// because an image that stops mid-page otherwise reads as a broken page.
//
// Pure, so the arithmetic and the wording are tested without a frame.

export type Hold = {
  /** How far down the page the capture reaches, in CSS px. */
  shown: number;
  /** How tall the page is, in CSS px, as the run measured it. */
  page: number;
};

/** Whole CSS pixels, grouped: 19588 → "19,588". */
function px(n: number): string {
  return Math.round(n).toLocaleString("en-GB");
}

/**
 * The hold, or null when the capture reaches the foot of the page — and when
 * either height is unknown, because a caption that guesses is worse than none.
 *
 * @param page   the page's own height in CSS px (the run's `page.scrollHeight`)
 * @param shown  the height of the capture on screen, in CSS px of the page
 */
export function captureHold(page: number | null | undefined, shown: number | null | undefined): Hold | null {
  if (typeof page !== "number" || typeof shown !== "number") return null;
  if (!(page > 0) || !(shown > 0) || !Number.isFinite(page) || !Number.isFinite(shown)) return null;
  // The capture is cut to whole device pixels and the page is measured in CSS
  // px, so the two never land exactly on each other. A hold is thousands of
  // pixels; a few is arithmetic.
  if (shown >= page - 4) return null;
  return { shown, page };
}

/** The line under the frame. */
export function holdNote(hold: Hold): string {
  return `Capture stops ${px(hold.shown)}px into a ${px(hold.page)}px page — the tallest a screenshot can be. `
    + "Findings below it were measured, not drawn.";
}

/**
 * Why a finding has no picture: the capture stopped short of it, or the run's
 * full page is gone and only the fold is left. The two look the same in the
 * frame and are not the same thing — one is a limit, the other is a run to
 * repeat — so the rail says which.
 */
export function undrawnLabel(hold: Hold | null): string {
  return hold ? "below where the capture stops — measured, not drawn" : "full page not stored for this run";
}
