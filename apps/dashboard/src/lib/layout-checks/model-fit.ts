// How far back the camera stands so the 3D handset fits its box. Pure, so the
// arithmetic is tested without WebGL.

export type ModelSize = { width: number; height: number; depth: number };

/**
 * The camera distance, from the model's centre, at which the model fills
 * `fill` of the canvas in whichever direction is tighter.
 *
 * Width is taken as the diagonal of the footprint (width × depth) so that a
 * handset turned about its vertical axis still fits; height is the model's
 * own. The near face is `depth / 2` in front of the centre, so that is added
 * back: the fit is measured at the front of the body, not in its middle.
 */
export function cameraDistance(size: ModelSize, fovDeg: number, aspect: number, fill: number): number {
  if (!(size.height > 0) || !(aspect > 0) || !(fill > 0) || !(fovDeg > 0 && fovDeg < 180)) return 0;
  const tanV = Math.tan((fovDeg * Math.PI) / 360);
  const tanH = tanV * aspect;
  const across = Math.hypot(size.width, size.depth);
  const forHeight = size.height / 2 / (tanV * fill);
  const forWidth = across / 2 / (tanH * fill);
  return Math.max(forHeight, forWidth) + size.depth / 2;
}
