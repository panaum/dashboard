import { test } from "node:test";
import assert from "node:assert/strict";
import { cameraDistance } from "./model-fit";

// The Galaxy S25 model's bounding box, in model units.
const S25 = { width: 2.2532, height: 4.6808, depth: 0.3002 };
const FOV = 22, FILL = 0.97;

// The largest share of the canvas (height or width) any corner of the box
// takes from camera distance d, in one pose.
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

test("facing front, a tall box is filled to exactly the requested height", () => {
  const d = cameraDistance(S25, FOV, 1, FILL);
  assert.ok(Math.abs(share(d, 1, 0, 0) - FILL) < 1e-9);
  assert.equal(cameraDistance(S25, FOV, 1, FILL, { yaw: 0, pitch: 0 }), d, "the default pose is front");
});

test("a box narrower than the handset's shape is limited by width instead", () => {
  const narrow = cameraDistance(S25, FOV, 0.3, FILL);
  assert.ok(narrow > cameraDistance(S25, FOV, 1, FILL));
  assert.ok(Math.abs(share(narrow, 0.3, 0, 0) - FILL) < 1e-9);
});

test("in every pose the handset exactly fills its box — never past it, never shrunk for a pose it is not in", () => {
  for (const aspect of [0.3, 0.9, 1.4]) {
    for (let yaw = -196; yaw <= 196; yaw += 7) {
      for (let pitch = -46; pitch <= 46; pitch += 6.5) {
        const s = share(cameraDistance(S25, FOV, aspect, FILL, { yaw, pitch }), aspect, yaw, pitch);
        assert.ok(Math.abs(s - FILL) < 1e-9, `aspect ${aspect}, yaw ${yaw}, pitch ${pitch}: ${s}`);
      }
    }
  }
});

test("the camera eases back as the handset turns and returns as it comes back", () => {
  const at = (yaw: number) => cameraDistance(S25, FOV, 0.9, FILL, { yaw, pitch: 0 });
  assert.ok(at(30) > at(0) && at(60) > at(30), "further back as it turns towards side-on");
  assert.ok(Math.abs(at(-60) - at(60)) < 1e-9, "the same either way");
  assert.ok(Math.abs(at(180) - at(0)) < 1e-9, "facing away is as big as facing front");
  // Continuous: no jump between nearby angles, which would read as a lurch.
  for (let yaw = 0; yaw < 180; yaw += 0.5) assert.ok(Math.abs(at(yaw + 0.5) - at(yaw)) < 0.05, `jump at ${yaw}°`);
});

test("nothing sensible to fit gives a distance of zero rather than NaN or Infinity", () => {
  assert.equal(cameraDistance(S25, FOV, 0, FILL), 0);
  assert.equal(cameraDistance(S25, 0, 1, FILL), 0);
  assert.equal(cameraDistance({ width: 0, height: 0, depth: 0 }, FOV, 1, FILL), 0);
  assert.equal(cameraDistance(S25, FOV, Number.NaN, FILL), 0);
});
