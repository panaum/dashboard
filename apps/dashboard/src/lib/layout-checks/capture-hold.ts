// Where a full-page capture stops, and how to say so.
//
// One screenshot is one image, and an image cannot be taller than 32,767
// pixels — a limit in the browsers' own graphics layer, not a setting of ours.
// devicepreview now spends that limit on the whole page rather than on pixel
// density: a page too tall to fit at 3x is captured at 1x instead, so a hold
// is left only for a page over 32,767 CSS px, which is rare.
//
// Two things still bring the reader here. Runs captured before that change
// have the truncated image they were taken with, and always will — a run is
// evidence, not something to re-render. And a page can be taller than any
// image at any scale. Either way devicepreview measures every finding from
// the DOM whatever the image holds and says so in the run's notes; this puts
// the same fact where the reader is looking at the capture, because an image
// that stops mid-page otherwise reads as a broken page.
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

/** No image may be taller than this in any dimension, at any scale. */
const IMAGE_LIMIT_PX = 32767;

/** The line under the frame — and, where there is one, what to do about it. */
export function holdNote(hold: Hold): string {
  // A run keeps the image it was taken with, so an old capture stays short
  // however the service captures today. Running the check again is the whole
  // fix, and saying so turns a dead end into one button — but only where it is
  // true: a page taller than any image at any scale will stop short again.
  const fixable = hold.page <= IMAGE_LIMIT_PX;
  return `Capture stops ${px(hold.shown)}px into a ${px(hold.page)}px page. `
    + (fixable
        ? "Run the check again and the new capture takes in all of it. "
        : "No screenshot can be taller, at any scale. ")
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

/**
 * A page too tall to fit at the device's own pixel density is captured whole
 * at 1x instead — the run says so, and so does this, because at actual size
 * the difference is visible and otherwise unexplained. Null when the capture
 * is at the device's density, which is most of them.
 */
export function softCaptureNote(fullScale: string | null | undefined, pageCssHeight: number | null | undefined): string | null {
  if (fullScale !== "css") return null;
  const tall = typeof pageCssHeight === "number" && pageCssHeight > 0 ? ` so all ${px(pageCssHeight)}px of it fit` : "";
  return `Full page captured at 1x${tall} — the first screen is at the device's own density.`;
}
