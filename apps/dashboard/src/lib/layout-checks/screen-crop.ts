// Which part of a capture goes on the 3D handset's screen, and at what size.
// Pure, so it is tested without a canvas.
//
// A capture is the page at the profile's width: one screen tall (the stored
// fold) or the whole page (the full capture, often many screens). The screen
// shows the first screen of it — the top of the page, as the handset would on
// load — cut to the screen mesh's own proportions, so the image is never
// stretched whatever the capture's height. A page shorter than one screen is
// drawn at the top and the rest left white, as the flat frame does.

export type Crop = {
  /** The texture's size in pixels. */
  width: number;
  height: number;
  /** How much of the capture is taken, from its top-left corner. */
  sourceWidth: number;
  sourceHeight: number;
  /** How far down the texture that part reaches; white below. */
  drawnHeight: number;
};

/**
 * @param natural the capture's pixel size
 * @param aspect  the screen mesh's width ÷ height
 * @param maxSide the largest texture side to make (GPU limit, and memory)
 */
export function screenCrop(natural: { width: number; height: number }, aspect: number, maxSide: number): Crop | null {
  if (!(natural.width > 0) || !(natural.height > 0) || !(aspect > 0) || !(maxSide >= 1)) return null;
  // No wider than the capture (no invented detail), and neither side past maxSide.
  const width = Math.max(1, Math.floor(Math.min(natural.width, maxSide, maxSide * aspect)));
  const height = Math.max(1, Math.min(maxSide, Math.round(width / aspect)));
  const sourceHeight = Math.min(natural.height, natural.width / aspect);
  const drawnHeight = Math.min(height, Math.round((sourceHeight * width) / natural.width));
  return { width, height, sourceWidth: natural.width, sourceHeight, drawnHeight };
}
