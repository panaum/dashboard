import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DEVICE_MODELS, modelFile, modelFor, modelUrl, SCREEN_MATERIAL } from "./models-3d";

test("a device with a model resolves to it; anything else to nothing", () => {
  const s25 = modelFor("galaxy-s25");
  assert.ok(s25);
  assert.equal(modelUrl(s25), "/api/models/galaxy-s25");
  const iphone = modelFor("iphone-16");
  assert.ok(iphone);
  assert.equal(modelUrl(iphone), "/api/models/iphone-16");
  assert.equal(iphone.turn, 180, "this model is exported facing away");
  for (const device of ["ipad-pro-13", "desktop-1440-chrome", "galaxy-s25-ultra", "", null, undefined]) {
    assert.equal(modelFor(device), null, String(device));
  }
});

test("the route's allow-list matches whole names only — a request cannot name a path", () => {
  assert.equal(modelFile("galaxy-s25"), "galaxy-s25");
  assert.equal(modelFile("iphone-16"), "iphone-16");
  for (const bad of ["galaxy-s25.glb", "../galaxy-s25", "../../assets/models/galaxy-s25",
                     "/etc/passwd", "galaxy-s25/../galaxy-s25", "", "GALAXY-S25", "iphone-16.glb"]) {
    assert.equal(modelFile(bad), null, bad);
  }
});

test("every entry names a file that is actually there, and is a plain name", () => {
  for (const m of DEVICE_MODELS) {
    assert.match(m.file, /^[a-z0-9-]+$/, `${m.device}: ${m.file}`);
    assert.ok(existsSync(resolve(process.cwd(), "assets", "models", `${m.file}.glb`)),
              `assets/models/${m.file}.glb is missing`);
  }
});

test("every entry carries its credit and what was stripped — CC BY, and the next reader", () => {
  for (const m of DEVICE_MODELS) {
    for (const [field, value] of Object.entries(m.credit)) {
      assert.ok(value.trim().length > 0, `${m.device}: credit.${field} is empty`);
    }
    assert.match(m.credit.source, /^https:\/\//, m.device);
    assert.match(m.credit.profile, /^https:\/\//, m.device);
    assert.match(m.credit.licence, /CC BY/, `${m.device}: only CC BY models are usable here`);
    assert.ok(m.stripped.trim().length > 0, `${m.device}: say what the optimiser removed`);
  }
});

test("one model per device", () => {
  const devices = DEVICE_MODELS.map((m) => m.device);
  assert.equal(new Set(devices).size, devices.length);
  const files = DEVICE_MODELS.map((m) => m.file);
  assert.equal(new Set(files).size, files.length);
});


// ── The models themselves ────────────────────────────────────────────────
// handset-3d.tsx turns each model by its registry `turn` and then measures it:
// the camera fit, the contact shadow and the crop put on the screen all read
// the turned box as width, height, depth. That only holds if `turn` really does
// bring the screen round to face the reader, which is a property of the pair —
// the committed .glb and the number beside it — and nothing in the component
// can check it. So it is checked here, against the files themselves.
//
// Reading the .glb needs no glTF library: the JSON chunk carries the node tree,
// and a POSITION accessor is required to carry min and max, which is the box.
// Positions may be quantized (KHR_mesh_quantization): normalized integers with
// the scale on the node, so min/max are de-normalized the same way three does.

type Mat4 = number[];   // row-major, 16

/** Only the parts of a .glb this reads. */
type GltfNode = { mesh?: number; children?: number[] } & Record<string, unknown>;
type Gltf = {
  scene?: number;
  scenes: { nodes: number[] }[];
  nodes: GltfNode[];
  meshes: { primitives?: { material?: number; attributes: Record<string, number> }[] }[];
  materials?: { name?: string }[];
  accessors: { min: number[]; max: number[]; componentType: number; normalized?: boolean }[];
};

function multiply(a: Mat4, b: Mat4): Mat4 {
  const out = new Array(16).fill(0);
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
    for (let k = 0; k < 4; k++) out[i * 4 + j] += a[i * 4 + k] * b[k * 4 + j];
  }
  return out;
}

function apply(m: Mat4, v: [number, number, number]): [number, number, number] {
  return [0, 1, 2].map((i) => m[i * 4] * v[0] + m[i * 4 + 1] * v[1] + m[i * 4 + 2] * v[2] + m[i * 4 + 3]) as
    [number, number, number];
}

function yaw(deg: number): Mat4 {
  const c = Math.cos((deg * Math.PI) / 180), s = Math.sin((deg * Math.PI) / 180);
  return [c, 0, s, 0, 0, 1, 0, 0, -s, 0, c, 0, 0, 0, 0, 1];
}

/** A glTF node's own transform: an explicit matrix, or translation × rotation × scale. */
function nodeMatrix(node: Record<string, unknown>): Mat4 {
  const m = node.matrix as number[] | undefined;
  // glTF matrices are column-major; ours are row-major.
  if (m) return [m[0], m[4], m[8], m[12], m[1], m[5], m[9], m[13], m[2], m[6], m[10], m[14], m[3], m[7], m[11], m[15]];
  const [tx, ty, tz] = (node.translation as number[]) ?? [0, 0, 0];
  const [x, y, z, w] = (node.rotation as number[]) ?? [0, 0, 0, 1];
  const [sx, sy, sz] = (node.scale as number[]) ?? [1, 1, 1];
  const r = [
    1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w),
    2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w),
    2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y),
  ];
  const s = [sx, sy, sz];
  return [
    r[0] * s[0], r[1] * s[1], r[2] * s[2], tx,
    r[3] * s[0], r[4] * s[1], r[5] * s[2], ty,
    r[6] * s[0], r[7] * s[1], r[8] * s[2], tz,
    0, 0, 0, 1,
  ];
}

const NORMALIZED_MAX: Record<number, number> = { 5120: 127, 5121: 255, 5122: 32767, 5123: 65535 };

/** The .glb's JSON chunk. */
function gltfJson(file: string): Gltf {
  const buf = readFileSync(resolve(process.cwd(), "assets", "models", `${file}.glb`));
  assert.equal(buf.toString("utf8", 0, 4), "glTF", `${file}: not a .glb`);
  const length = buf.readUInt32LE(12);
  assert.equal(buf.readUInt32LE(16), 0x4e4f534a, `${file}: first chunk is not JSON`);
  return JSON.parse(buf.toString("utf8", 20, 20 + length));
}

/** Size of the screen mesh's box, in the scene, with the model turned by `turn`. */
function screenExtent(file: string, turn: number): { x: number; y: number; z: number; meshes: number } {
  const gltf = gltfJson(file);
  const screen = (gltf.materials ?? []).findIndex((m) => m.name === SCREEN_MATERIAL);
  assert.notEqual(screen, -1, `${file}: no material named ${SCREEN_MATERIAL}`);
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  let meshes = 0;
  const walk = (index: number, parent: Mat4) => {
    const node = gltf.nodes[index];
    const world = multiply(parent, nodeMatrix(node));
    if (node.mesh !== undefined) {
      for (const prim of gltf.meshes[node.mesh].primitives ?? []) {
        if (prim.material !== screen) continue;
        meshes++;
        const acc = gltf.accessors[prim.attributes.POSITION];
        const d = acc.normalized ? NORMALIZED_MAX[acc.componentType] : 1;
        const min = acc.min.map((v) => v / d), max = acc.max.map((v) => v / d);
        for (const cx of [min[0], max[0]]) for (const cy of [min[1], max[1]]) for (const cz of [min[2], max[2]]) {
          const p = apply(world, [cx, cy, cz]);
          for (let i = 0; i < 3; i++) { lo[i] = Math.min(lo[i], p[i]); hi[i] = Math.max(hi[i], p[i]); }
        }
      }
    }
    for (const child of node.children ?? []) walk(child, world);
  };
  for (const root of gltf.scenes[gltf.scene ?? 0].nodes) walk(root, yaw(turn));
  return { x: hi[0] - lo[0], y: hi[1] - lo[1], z: hi[2] - lo[2], meshes };
}

test("turned by its registry angle, every model's screen faces the reader in portrait", () => {
  for (const m of DEVICE_MODELS) {
    const e = screenExtent(m.file, m.turn ?? 0);
    assert.equal(e.meshes, 1, `${m.file}: ${e.meshes} meshes use ${SCREEN_MATERIAL}; the component takes one`);
    // Flat towards the camera: the thickness left in z is the mesh's own
    // curvature, not one of its sides. A screen still edge-on after the turn
    // lands here rather than as a blank screen in the browser.
    assert.ok(e.z < e.y * 0.03, `${m.file}: screen is ${e.z.toFixed(3)} deep against ${e.y.toFixed(3)} tall — not facing front`);
    // A handset screen: taller than it is wide, and about 0.46 on all of them.
    const aspect = e.x / e.y;
    assert.ok(aspect > 0.4 && aspect < 0.55,
              `${m.file}: screen reads ${aspect.toFixed(4)} wide ÷ tall; the capture is cropped to this`);
  }
});
