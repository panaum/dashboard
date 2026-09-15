// How far back the camera stands so the 3D handset fits its box. Pure, so the
// arithmetic is tested without WebGL.

export type ModelSize = { width: number; height: number; depth: number };
/** The furthest the body can turn from facing front, in degrees, each way. */
export type Turns = { yaw: number; pitch: number };

const STEP_DEG = 5;

/**
 * The camera distance, from the model's centre, at which no corner of the
 * model's box leaves `fill` of the canvas — in any pose it can reach.
 *
 * Facing front is not the worst case. Turned, the nearer edge comes towards
 * the camera and grows in perspective: at 70° of yaw a body fitted only for
 * the front ran off the top of its box. So every pose up to `turns` is
 * sampled (the box is symmetric, so one quadrant is enough), every corner is
 * rotated as the component rotates it (yaw, then pitch in world space), and
 * the camera stands back far enough for the worst of them.
 */
export function cameraDistance(size: ModelSize, fovDeg: number, aspect: number, fill: number, turns: Turns = { yaw: 0, pitch: 0 }): number {
  if (!(size.height > 0) || !(aspect > 0) || !(fill > 0) || !(fovDeg > 0 && fovDeg < 180)) return 0;
  const tanV = Math.tan((fovDeg * Math.PI) / 360);
  const tanH = tanV * aspect;
  const hx = size.width / 2, hy = size.height / 2, hz = size.depth / 2;
  const maxYaw = Math.min(90, Math.max(0, turns.yaw)), maxPitch = Math.min(90, Math.max(0, turns.pitch));
  const angles = (max: number) => {
    const out: number[] = [];
    for (let a = 0; a < max; a += STEP_DEG) out.push(a);
    out.push(max);
    return out;
  };
  let d = 0;
  for (const yawDeg of angles(maxYaw)) {
    const cy = Math.cos((yawDeg * Math.PI) / 180), sy = Math.sin((yawDeg * Math.PI) / 180);
    for (const pitchDeg of angles(maxPitch)) {
      const cp = Math.cos((pitchDeg * Math.PI) / 180), sp = Math.sin((pitchDeg * Math.PI) / 180);
      for (const x of [-hx, hx]) for (const y of [-hy, hy]) for (const z of [-hz, hz]) {
        const x1 = x * cy + z * sy, z1 = -x * sy + z * cy;          // yaw about y
        const y2 = y * cp - z1 * sp, z2 = y * sp + z1 * cp;         // pitch about x
        d = Math.max(d, Math.abs(y2) / (tanV * fill) + z2, Math.abs(x1) / (tanH * fill) + z2);
      }
    }
  }
  return d;
}
