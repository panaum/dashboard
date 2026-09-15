import { test } from "node:test";
import assert from "node:assert/strict";
import { cameraDistance } from "./model-fit";

// The Galaxy S25 model's bounding box, in model units.
const S25 = { width: 2.2532, height: 4.6808, depth: 0.3002 };
const FOV = 22, FILL = 0.94;
const TURNS = { yaw: 180, pitch: 46 };

// The largest share of the canvas (height or width, whichever is larger) any
// corner of the box takes from camera distance d, in one pose.
function share(d: number, aspect: number, yawDeg: number, pitchDeg: number): number {
  const tanV = Math.tan((FOV * Math.PI) / 360), tanH = tanV * aspect;
  const r = Math.PI / 180, cy = Math.cos(yawDeg * r), sy = Math.sin(yawDeg * r), cp = Math.cos(pitchDeg * r), sp = Math.sin(pitchDeg * r);
  let worst = 0;
  for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) {
    const px = (x * S25.width) / 2, py = (y * S25.height) / 2, pz = (z * S25.depth) / 2;
    const x1 = px * cy + pz * sy, z1 = -px * sy + pz * cy;
    const y2 = py * cp - z1 * sp, z2 = py * sp + z1 * cp;
    worst = Math.max(worst, Math.abs(y2) / ((d - z2) * tanV), Math.abs(x1) / ((d - z2) * tanH));
  }
  return worst;
}

test("facing front only, a tall box is filled to exactly the requested height", () => {
  const d = cameraDistance(S25, FOV, 1, FILL);
  assert.ok(Math.abs(share(d, 1, 0, 0) - FILL) < 1e-9);
});

test("a box narrower than the handset's shape is limited by width instead", () => {
  const narrow = cameraDistance(S25, FOV, 0.3, FILL);
  assert.ok(narrow > cameraDistance(S25, FOV, 1, FILL), "a narrow box has to stand the camera further back");
  assert.ok(Math.abs(share(narrow, 0.3, 0, 0) - FILL) < 1e-9, "and is still filled to the limit, by width");
});

test("no pose within the turns leaves the box — checked at poses between the sampled ones", () => {
  for (const aspect of [0.3, 0.9, 1.4]) {
    const d = cameraDistance(S25, FOV, aspect, FILL, TURNS);
    let worst = 0;
    for (let yaw = -180; yaw <= 180; yaw += 1.3) {
      for (let pitch = -46; pitch <= 46; pitch += 1.7) worst = Math.max(worst, share(d, aspect, yaw, pitch));
    }
    // Sampling every 5° can miss the true peak by a hair; it must be a hair.
    assert.ok(worst <= FILL * 1.002, `aspect ${aspect}: a pose took ${worst.toFixed(4)} of the canvas`);
    assert.ok(worst > FILL * 0.99, `aspect ${aspect}: and the fit is tight, not wasteful (${worst.toFixed(4)})`);
  }
});

test("a turned handset needs the camera further back than one facing front", () => {
  assert.ok(cameraDistance(S25, FOV, 0.9, FILL, TURNS) > cameraDistance(S25, FOV, 0.9, FILL));
});

test("nothing sensible to fit gives a distance of zero rather than NaN or Infinity", () => {
  assert.equal(cameraDistance(S25, FOV, 0, FILL), 0);
  assert.equal(cameraDistance(S25, 0, 1, FILL), 0);
  assert.equal(cameraDistance({ width: 0, height: 0, depth: 0 }, FOV, 1, FILL), 0);
  assert.equal(cameraDistance(S25, FOV, Number.NaN, FILL), 0);
});
