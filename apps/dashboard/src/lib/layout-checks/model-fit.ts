// How far back the camera stands so the 3D handset fits its box. Pure, so the
// arithmetic is tested without WebGL.

export type ModelSize = { width: number; height: number; depth: number };
/** Degrees: yaw about the vertical axis, then pitch about the horizontal. */
export type Pose = { yaw: number; pitch: number };

/**
 * The camera distance, from the model's centre, at which no corner of the
 * model's box leaves `fill` of the canvas in the pose it is in right now.
 *
 * Facing front, that is a fit to the front, so the handset is as large as the
 * flat frame it replaces. Turned, the nearer edge comes towards the camera and
 * grows in perspective, so the distance grows with it: the camera eases back
 * as the handset turns and forward as it returns, and it never runs off its
 * box. Called every frame; it is eight corners of arithmetic.
 *
 * The corners are rotated as the component rotates the model — yaw, then
 * pitch in world space — and a box's projection is bounded by its corners.
 */
export function cameraDistance(size: ModelSize, fovDeg: number, aspect: number, fill: number, pose: Pose = { yaw: 0, pitch: 0 }): number {
  if (!(size.height > 0) || !(aspect > 0) || !(fill > 0) || !(fovDeg > 0 && fovDeg < 180)) return 0;
  const tanV = Math.tan((fovDeg * Math.PI) / 360);
  const tanH = tanV * aspect;
  const r = Math.PI / 180;
  const cy = Math.cos(pose.yaw * r), sy = Math.sin(pose.yaw * r);
  const cp = Math.cos(pose.pitch * r), sp = Math.sin(pose.pitch * r);
  const hx = size.width / 2, hy = size.height / 2, hz = size.depth / 2;
  let d = 0;
  for (const x of [-hx, hx]) for (const y of [-hy, hy]) for (const z of [-hz, hz]) {
    const x1 = x * cy + z * sy, z1 = -x * sy + z * cy;      // yaw about y
    const y2 = y * cp - z1 * sp, z2 = y * sp + z1 * cp;     // pitch about x
    d = Math.max(d, Math.abs(y2) / (tanV * fill) + z2, Math.abs(x1) / (tanH * fill) + z2);
  }
  return d;
}
