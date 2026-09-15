import { test } from "node:test";
import assert from "node:assert/strict";
import {
  coast, dragged, excess, facingFront, isFront, releaseVelocity, resist, settled, unresist,
  COAST_TAU, DEG_PER_PX, FACE_FRONT_MS, LIMIT, MAX_SPEED, STRETCH, type Coast, type Sample,
} from "./model-rotation";

// Run the coast at 60 frames a second until it settles (or a generous timeout).
function run(state: Coast, maxMs = 10_000): { end: Coast; ms: number; furthest: { yaw: number; pitch: number } } {
  let s = state, ms = 0;
  const furthest = { yaw: Math.abs(s.rot.yaw), pitch: Math.abs(s.rot.pitch) };
  while (!settled(s) && ms < maxMs) {
    s = coast(s, 16.67); ms += 16.67;
    furthest.yaw = Math.max(furthest.yaw, Math.abs(s.rot.yaw));
    furthest.pitch = Math.max(furthest.pitch, Math.abs(s.rot.pitch));
  }
  return { end: s, ms, furthest };
}

test("inside the limits a drag follows the pointer one for one", () => {
  const { shown } = dragged({ yaw: 0, pitch: 0 }, 100, -40);
  assert.equal(shown.yaw, 100 * DEG_PER_PX);
  assert.equal(shown.pitch, -40 * DEG_PER_PX);
});

test("dragging right turns the screen right, dragging down brings the top forward", () => {
  const { shown } = dragged({ yaw: 0, pitch: 0 }, 10, 10);
  assert.ok(shown.yaw > 0 && shown.pitch > 0);
});

test("past a limit the drag gives, but never by more than STRETCH however far it goes", () => {
  const near = resist(LIMIT.pitch + 1, LIMIT.pitch);
  assert.ok(near > LIMIT.pitch && near < LIMIT.pitch + 1, "resistance starts at once");
  for (const raw of [40, 100, 1_000, 1e6]) {
    const shown = resist(raw, LIMIT.pitch);
    assert.ok(shown < LIMIT.pitch + STRETCH, `raw ${raw} showed ${shown}`);
    assert.equal(resist(-raw, LIMIT.pitch), -shown, "and the same the other way");
  }
});

test("the give is continuous at the limit: no jump as the pointer crosses it", () => {
  const eps = 1e-6;
  assert.ok(Math.abs(resist(LIMIT.yaw + eps, LIMIT.yaw) - resist(LIMIT.yaw - eps, LIMIT.yaw)) < 1e-5);
});

test("unresist undoes resist, so a drag started mid-spring-back does not jump", () => {
  for (const raw of [0, 20, 29.9, 31, 45, 90]) {
    assert.ok(Math.abs(unresist(resist(raw, LIMIT.pitch), LIMIT.pitch) - raw) < 1e-6, `raw ${raw}`);
  }
});

test("a flick inside the limits coasts to a stop, travelling about speed × tau", () => {
  const v = 0.2;
  const { end } = run({ rot: { yaw: 0, pitch: 0 }, vel: { yaw: v, pitch: 0 } });
  assert.ok(settled(end));
  assert.ok(Math.abs(end.rot.yaw - v * COAST_TAU) < v * COAST_TAU * 0.1, `stopped at ${end.rot.yaw}`);
});

test("a hard flick towards a limit stops past it by less than STRETCH, then comes back to the limit", () => {
  const { end, furthest } = run({ rot: { yaw: 0, pitch: 20 }, vel: { yaw: 0, pitch: MAX_SPEED } });
  assert.ok(furthest.pitch > LIMIT.pitch, "it does reach past the limit");
  assert.ok(furthest.pitch <= LIMIT.pitch + STRETCH);
  assert.ok(settled(end));
  assert.equal(end.rot.pitch, LIMIT.pitch);
});

test("a release held past the limit with no speed springs back inside it quickly", () => {
  const { end, ms } = run({ rot: { yaw: -(LIMIT.yaw + 12), pitch: 0 }, vel: { yaw: 0, pitch: 0 } });
  assert.equal(end.rot.yaw, -LIMIT.yaw);
  assert.ok(ms < 1_000, `took ${ms} ms`);
});

test("a coast always comes to rest", () => {
  for (const vel of [{ yaw: MAX_SPEED, pitch: -MAX_SPEED }, { yaw: -0.01, pitch: 0.7 }, { yaw: 0.004, pitch: 0 }]) {
    const { end, ms } = run({ rot: { yaw: 170, pitch: -25 }, vel });
    assert.ok(settled(end), `still moving after ${ms} ms from ${JSON.stringify(vel)}`);
    assert.equal(excess(end.rot.yaw, LIMIT.yaw), 0);
    assert.equal(excess(end.rot.pitch, LIMIT.pitch), 0);
  }
});

test("release speed is the recent movement; a pointer that stopped throws nothing", () => {
  const samples: Sample[] = [
    { t: 0, rot: { yaw: 0, pitch: 0 } },
    { t: 100, rot: { yaw: 5, pitch: 0 } },
    { t: 140, rot: { yaw: 10, pitch: 2 } },
    { t: 180, rot: { yaw: 18, pitch: 4 } },
  ];
  const v = releaseVelocity(samples, 185);
  assert.ok(Math.abs(v.yaw - (18 - 5) / 80) < 1e-9, "only the last 80 ms count");
  assert.ok(Math.abs(v.pitch - 4 / 80) < 1e-9);
  assert.deepEqual(releaseVelocity(samples, 300), { yaw: 0, pitch: 0 });
  assert.deepEqual(releaseVelocity([], 0), { yaw: 0, pitch: 0 });
  assert.deepEqual(releaseVelocity([samples[3]], 181), { yaw: 0, pitch: 0 }, "one sample is not a flick");
});

test("release speed is capped", () => {
  const v = releaseVelocity([{ t: 0, rot: { yaw: 0, pitch: 0 } }, { t: 10, rot: { yaw: 500, pitch: -500 } }], 10);
  assert.equal(v.yaw, MAX_SPEED);
  assert.equal(v.pitch, -MAX_SPEED);
});

test("face front starts where the handset is, lands exactly on front, and never overshoots", () => {
  const from = { yaw: 150, pitch: -20 };
  assert.deepEqual(facingFront(from, 0), from);
  let prev = from;
  for (let t = 16; t < FACE_FRONT_MS; t += 16) {
    const r = facingFront(from, t);
    assert.ok(r.yaw <= prev.yaw && r.yaw >= 0, `yaw ${r.yaw} at ${t} ms`);
    assert.ok(r.pitch >= prev.pitch && r.pitch <= 0, `pitch ${r.pitch} at ${t} ms`);
    prev = r;
  }
  assert.ok(isFront(facingFront(from, FACE_FRONT_MS)));
  assert.deepEqual(facingFront(from, FACE_FRONT_MS * 3), { yaw: 0, pitch: 0 });
});
