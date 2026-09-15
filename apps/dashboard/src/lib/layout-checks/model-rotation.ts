// How the 3D handset turns under the pointer: the limits, the give at the
// limits, the coast after a flick, and the ease back to face front. Pure and
// time-stepped, so it is tested without a browser; the component only feeds
// it pointer positions and frame times.
//
// Angles are degrees. Yaw turns the handset about its vertical axis (positive:
// the screen turns to the viewer's right); pitch tips it about the horizontal
// axis (positive: the top comes towards the viewer). Dragging right turns it
// right and dragging down brings the top forward, as if it were held.

export type Rotation = { yaw: number; pitch: number };
export type Velocity = { yaw: number; pitch: number };   // degrees per ms
export type Coast = { rot: Rotation; vel: Velocity };

/** Half a turn each way, so the back can be seen but the handset never spins
 *  past it; a moderate tip, so the screen stays readable. */
export const LIMIT: Rotation = { yaw: 180, pitch: 30 };
export const FRONT: Rotation = { yaw: 0, pitch: 0 };

export const DEG_PER_PX = 0.35;
/** How far a drag can pull past a limit, however far the pointer goes. */
export const STRETCH = 16;
/** A flick's speed falls by 1/e every COAST_TAU ms: it travels speed × tau. */
export const COAST_TAU = 325;
/** Past a limit, the remaining speed dies fast… */
export const BRAKE_TAU = 30;
/** …and the overshoot springs back with this time constant. */
export const RETURN_TAU = 90;
export const MAX_SPEED = 1.5;
export const STOP_SPEED = 0.005;
export const FACE_FRONT_MS = 500;
/** Pointer samples older than this do not count towards a flick. */
export const VELOCITY_WINDOW_MS = 80;
/** A pointer held still this long before release throws nothing. */
export const STILL_MS = 50;

const sign = (v: number) => (v < 0 ? -1 : 1);

/** The signed distance past a limit; zero inside it. */
export function excess(value: number, limit: number): number {
  const over = Math.abs(value) - limit;
  return over > 0 ? sign(value) * over : 0;
}

/** A drag's raw angle, with the part past the limit given resistance: it
 *  follows the pointer one-for-one at the limit and never exceeds STRETCH. */
export function resist(raw: number, limit: number): number {
  const over = Math.abs(raw) - limit;
  if (over <= 0) return raw;
  return sign(raw) * (limit + STRETCH * (1 - 1 / (1 + over / STRETCH)));
}

/** The inverse of `resist`: the raw angle that shows as `shown`. A drag that
 *  starts while the handset is still springing back picks up where it is. */
export function unresist(shown: number, limit: number): number {
  const over = Math.min(Math.abs(shown) - limit, STRETCH * 0.999);
  if (over <= 0) return shown;
  return sign(shown) * (limit + (STRETCH * over) / (STRETCH - over));
}

/** Where a drag that began at `start` (raw angles) shows after moving dx, dy CSS px. */
export function dragged(start: Rotation, dx: number, dy: number): { raw: Rotation; shown: Rotation } {
  const raw = { yaw: start.yaw + dx * DEG_PER_PX, pitch: start.pitch + dy * DEG_PER_PX };
  return { raw, shown: { yaw: resist(raw.yaw, LIMIT.yaw), pitch: resist(raw.pitch, LIMIT.pitch) } };
}

export type Sample = { t: number; rot: Rotation };

/** The speed a release throws: the raw angle's change over the last
 *  VELOCITY_WINDOW_MS, or nothing if the pointer had stopped. */
export function releaseVelocity(samples: Sample[], now: number): Velocity {
  const still = { yaw: 0, pitch: 0 };
  const last = samples[samples.length - 1];
  if (!last || now - last.t > STILL_MS) return still;
  const recent = samples.filter((s) => s.t >= last.t - VELOCITY_WINDOW_MS);
  const first = recent[0];
  const span = last.t - first.t;
  if (span < 8) return still;
  const cap = (v: number) => Math.max(-MAX_SPEED, Math.min(MAX_SPEED, v));
  return {
    yaw: cap((last.rot.yaw - first.rot.yaw) / span),
    pitch: cap((last.rot.pitch - first.rot.pitch) / span),
  };
}

function coastAxis(pos: number, vel: number, limit: number, dt: number): [number, number] {
  const over = excess(pos, limit);
  if (over === 0) {
    vel *= Math.exp(-dt / COAST_TAU);
    pos += vel * dt;
  } else if (vel !== 0 && sign(vel) === sign(over)) {
    vel *= Math.exp(-dt / BRAKE_TAU);
    pos += vel * dt;
  } else {
    vel = 0;
    const left = over * Math.exp(-dt / RETURN_TAU);
    pos = sign(over) * limit + (Math.abs(left) < 0.05 ? 0 : left);
  }
  // Never further past the limit than a drag could pull it.
  if (Math.abs(pos) > limit + STRETCH) { pos = sign(pos) * (limit + STRETCH); vel = 0; }
  if (Math.abs(vel) < STOP_SPEED) vel = 0;
  return [pos, vel];
}

/** One frame of coasting: dt ms of decay, braking and spring-back. */
export function coast(state: Coast, dt: number): Coast {
  const [yaw, vYaw] = coastAxis(state.rot.yaw, state.vel.yaw, LIMIT.yaw, dt);
  const [pitch, vPitch] = coastAxis(state.rot.pitch, state.vel.pitch, LIMIT.pitch, dt);
  return { rot: { yaw, pitch }, vel: { yaw: vYaw, pitch: vPitch } };
}

/** At rest and inside the limits: nothing left to draw. */
export function settled(state: Coast): boolean {
  return state.vel.yaw === 0 && state.vel.pitch === 0
    && excess(state.rot.yaw, LIMIT.yaw) === 0 && excess(state.rot.pitch, LIMIT.pitch) === 0;
}

export function isFront(rot: Rotation): boolean {
  return Math.abs(rot.yaw) < 0.05 && Math.abs(rot.pitch) < 0.05;
}

/** The rotation `elapsed` ms into turning back from `from` to face front. */
export function facingFront(from: Rotation, elapsed: number): Rotation {
  const t = Math.min(1, Math.max(0, elapsed / FACE_FRONT_MS));
  const k = 1 - (1 - t) ** 3;   // ease out: quick to start, gentle to land
  return t >= 1 ? { ...FRONT } : { yaw: from.yaw * (1 - k), pitch: from.pitch * (1 - k) };
}

// ── Idle drift ─────────────────────────────────────────────────────────────
// Left alone, the handset sways a few degrees about wherever it was put, so it
// reads as an object rather than a picture. It is not a spin: it never goes
// further than DRIFT from its resting pose, it starts only after the handset
// has been still for DRIFT_DELAY_MS, and it fades in over DRIFT_RAMP_MS so it
// never jumps. The two axes run at unrelated periods so it does not repeat
// visibly. Off entirely when the reader has asked for reduced motion.

export const DRIFT: Rotation = { yaw: 4, pitch: 1.5 };
export const DRIFT_PERIOD_MS: Rotation = { yaw: 9_000, pitch: 13_700 };
export const DRIFT_DELAY_MS = 2_000;
export const DRIFT_RAMP_MS = 2_500;

/** The sway to add to the resting pose, `idle` ms after the handset came to rest. */
export function driftOffset(idle: number): Rotation {
  if (!(idle > DRIFT_DELAY_MS)) return { yaw: 0, pitch: 0 };
  const t = Math.min(1, (idle - DRIFT_DELAY_MS) / DRIFT_RAMP_MS);
  const amp = t * t * (3 - 2 * t);   // smoothstep: no kick at the start
  const phase = idle - DRIFT_DELAY_MS;
  return {
    yaw: amp * DRIFT.yaw * Math.sin((2 * Math.PI * phase) / DRIFT_PERIOD_MS.yaw),
    pitch: amp * DRIFT.pitch * Math.sin((2 * Math.PI * phase) / DRIFT_PERIOD_MS.pitch),
  };
}

/** Where a released handset ends up with reduced motion on: inside the limits
 *  at once, with no coast and no spring. */
export function clampToLimits(rot: Rotation): Rotation {
  const clamp = (v: number, l: number) => Math.max(-l, Math.min(l, v));
  return { yaw: clamp(rot.yaw, LIMIT.yaw), pitch: clamp(rot.pitch, LIMIT.pitch) };
}
