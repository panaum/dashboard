// A FINDING AS A PICTURE.
//
// The row's thumbnail is the finding at a glance: the element, outlined, on
// the page around it, with its number. That is also the picture people want
// to drop into Slack or a ticket — and copying it as text ("Tap target 77 ×
// 14, a.wm-cta-m:nth-of-type(1)") loses the half that convinces. This plans
// that picture from the same window maths the row uses (crop.ts), at a size
// worth pasting rather than the row's 96px, so what is drawn matches what
// was shown.
//
// Pure: the geometry is tested without a canvas. Drawing it is the component's
// job, and the only part that needs a browser.

import { boxWithin, cropFor, type Box, type Rect } from "@/lib/layout-checks/crop";

export type ImagePlan = {
  /** The output image, in pixels. */
  width: number;
  height: number;
  /** The part of the capture to draw, in CAPTURE pixels (the stored image's own). */
  source: { x: number; y: number; width: number; height: number };
  /** Where the element sits on the output, in output pixels, for the outline. */
  outline: Rect;
  /** Where the number badge goes, in output pixels: the outline's top-left corner. */
  pin: { x: number; y: number };
};

/** How wide the copied picture is. Wide enough to read the page, small
 *  enough to paste into a chat without scrolling. */
export const IMAGE_WIDTH = 720;
export const IMAGE_HEIGHT = 450;

/**
 * @param box         the finding's element, in CSS px of the page
 * @param page        the page's size in CSS px (height null until the capture has loaded)
 * @param capture     the stored image's pixel size — its width over the page's is the density
 * @param window      how much page the picture covers, in CSS px. 60% of the
 *                    page, and never less than the element plus a margin: a
 *                    full-width banner cut to 60% loses its own ends.
 */
export function imagePlan(
  box: Box,
  page: { width: number; height: number | null },
  capture: { width: number; height: number },
  window?: number,
): ImagePlan | null {
  if (!(capture.width > 0) || !(capture.height > 0) || !(page.width > 0)) return null;
  const win = window ?? Math.min(page.width, Math.max(Math.round(page.width * 0.6), box.width + 48));
  const crop = cropFor(box, page.width, page.height, IMAGE_WIDTH, IMAGE_HEIGHT, 24, 200, win);
  if (!crop) return null;
  const density = capture.width / page.width;
  const outline = boxWithin(crop, box);
  return {
    width: IMAGE_WIDTH,
    height: IMAGE_HEIGHT,
    source: {
      x: Math.round(crop.x * density),
      y: Math.round(crop.y * density),
      width: Math.round(crop.w * density),
      height: Math.round(crop.h * density),
    },
    outline,
    pin: { x: outline.left, y: outline.top },
  };
}

/** The colours the picture is drawn in — the rail's own, by severity. */
export const INK: Record<"error" | "warn" | "info", string> = {
  error: "#b3261e",
  warn: "#8a5300",
  info: "#5f6270",
};
