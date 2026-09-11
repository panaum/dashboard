// A picture of the element itself, on its finding's row.
//
// "Tap target 77 × 14 · a.wm-cta-m:nth-of-type(1)" is a measurement; a crop
// of the capture around that box is the thing. The crop is a window onto the
// same image the frame is showing — no second request — positioned with CSS
// background geometry. Pure, so the window maths are tested rather than
// eyeballed against a 20,000px page.

export type Box = { x: number; y: number; width: number; height: number };

export type Crop = {
  /** Thumb px per page CSS px. */
  scale: number;
  /** The window's top-left corner and size, in page CSS px. */
  x: number;
  y: number;
  w: number;
  h: number;
};

export type Rect = { left: number; top: number; width: number; height: number };

/** Where `box` sits inside the crop's window, in thumb px, clipped to it —
 *  so the element can be outlined on its own picture. */
export function boxWithin(crop: Crop, box: Box): Rect {
  const left = Math.max(0, (box.x - crop.x) * crop.scale);
  const top = Math.max(0, (box.y - crop.y) * crop.scale);
  const right = Math.min(crop.w * crop.scale, (box.x + box.width - crop.x) * crop.scale);
  const bottom = Math.min(crop.h * crop.scale, (box.y + box.height - crop.y) * crop.scale);
  return { left: Math.round(left), top: Math.round(top), width: Math.max(0, Math.round(right - left)), height: Math.max(0, Math.round(bottom - top)) };
}

/** A `w`×`h` thumb window centred on `box`, with `pad` CSS px of context
 *  around it and never narrower than `minWidth`. Clamped to the page, so an
 *  element at the top edge shows the top edge rather than blank. Null when
 *  the box lies below the image we actually have. */
export function cropFor(box: Box, pageWidth: number, pageHeight: number | null, w: number, h: number,
                        pad = 20, minWidth = 140): Crop | null {
  if (pageWidth <= 0 || w <= 0 || h <= 0) return null;
  if (pageHeight !== null && box.y >= pageHeight) return null;
  const winW = Math.min(pageWidth, Math.max(minWidth, box.width + 2 * pad));
  const winH = winW * (h / w);
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  let x = cx - winW / 2, y = cy - winH / 2;
  x = Math.max(0, Math.min(pageWidth - winW, x));
  y = Math.max(0, pageHeight === null ? y : Math.min(Math.max(0, pageHeight - winH), y));
  return { scale: w / winW, x: Math.round(x), y: Math.round(y), w: winW, h: winH };
}

/** The inline style that paints that window from the page image. */
export function cropStyle(src: string, crop: Crop, pageWidth: number): React.CSSProperties {
  return {
    backgroundImage: `url("${src}")`,
    backgroundSize: `${Math.round(pageWidth * crop.scale)}px auto`,
    backgroundPosition: `${-Math.round(crop.x * crop.scale)}px ${-Math.round(crop.y * crop.scale)}px`,
    backgroundRepeat: "no-repeat",
  };
}
