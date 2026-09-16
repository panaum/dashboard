// Which part of a capture goes on the 3D handset's screen, and at what size.
// Pure, so it is tested without a canvas.
//
// A capture is the page at the profile's width: one screen tall (the stored
// fold) or the whole page (the full capture, often many screens). The screen
// shows one screen of it, cut to the screen mesh's own proportions, so the
// image is never stretched whatever the capture's height. Which screen is up
// to the reader: `sourceTop` scrolls down the capture. A page shorter than one
// screen is drawn at the top and the rest left white, as the flat frame does.

export type Crop = {
  /** The texture's size in pixels. */
  width: number;
  height: number;
  /** The part of the capture taken: full width, from `sourceTop` down. */
  sourceWidth: number;
  sourceTop: number;
  sourceHeight: number;
  /** How far down the texture that part reaches; white below. */
  drawnHeight: number;
};

/**
 * @param natural    the capture's pixel size
 * @param aspect     the screen mesh's width ÷ height
 * @param maxSide    the largest texture side to make (GPU limit, and memory)
 * @param sourceTop  how far down the capture to start, in capture pixels
 */
export function screenCrop(natural: { width: number; height: number }, aspect: number, maxSide: number, sourceTop = 0): Crop | null {
  if (!(natural.width > 0) || !(natural.height > 0) || !(aspect > 0) || !(maxSide >= 1)) return null;
  // No wider than the capture (no invented detail), and neither side past maxSide.
  const width = Math.max(1, Math.floor(Math.min(natural.width, maxSide, maxSide * aspect)));
  const height = Math.max(1, Math.min(maxSide, Math.round(width / aspect)));
  const screen = Math.min(natural.height, natural.width / aspect);
  const top = Math.max(0, Math.min(natural.height - screen, Number.isFinite(sourceTop) ? sourceTop : 0));
  const sourceHeight = Math.min(screen, natural.height - top);
  const drawnHeight = Math.min(height, Math.round((sourceHeight * width) / natural.width));
  return { width, height, sourceWidth: natural.width, sourceTop: top, sourceHeight, drawnHeight };
}

/**
 * How far the capture can be scrolled on the screen, in CSS pixels of the page.
 * Zero for a capture only one screen tall — the stored fold — which is how the
 * 3D view knows to let the wheel scroll the page instead.
 */
export function scrollRange(natural: { width: number; height: number }, viewport: { width: number; height: number }): number {
  if (!(natural.width > 0) || !(natural.height > 0) || !(viewport.width > 0) || !(viewport.height > 0)) return 0;
  const pageHeight = (natural.height * viewport.width) / natural.width;
  return Math.max(0, pageHeight - viewport.height);
}

/** CSS pixels of the page → pixels of the capture. */
export function toSourcePixels(scrollCss: number, natural: { width: number }, viewport: { width: number }): number {
  if (!(natural.width > 0) || !(viewport.width > 0) || !Number.isFinite(scrollCss)) return 0;
  return (scrollCss * natural.width) / viewport.width;
}
