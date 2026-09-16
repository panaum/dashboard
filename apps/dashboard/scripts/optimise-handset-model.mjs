// One-off: turns a downloaded Sketchfab handset into assets/models/<id>.glb.
//
// Not part of the build, and gltf-transform is deliberately not a dependency of
// this app. To run it, install the tools in a scratch directory and run the
// script from there:
//
//   mkdir /tmp/gltf-tool && cd /tmp/gltf-tool && npm init -y
//   npm i @gltf-transform/core@4.5.0 @gltf-transform/extensions@4.5.0 \
//         @gltf-transform/functions@4.5.0 meshoptimizer@1.2.0 sharp@0.35.4
//   node <repo>/apps/dashboard/scripts/optimise-handset-model.mjs <id> \
//        ~/Downloads/<download>.glb <repo>/apps/dashboard/assets/models/<id>.glb
//
// <id> is a key of MODELS below: what to strip from that particular download,
// and how hard to simplify each part. The output is NOT the file Sketchfab
// serves, and the difference is the point — see the entry's notes, the
// registry (src/lib/layout-checks/models-3d.ts) and
// docs/decisions/ADR-004-3d-galaxy-s25-internal-only.md.
//
// Every model comes out of here with:
//   - no maker's wordmark or logo (trademarks, on a tool that might not stay
//     internal, and nobody should have to find and undo a branded model later);
//   - no stock wallpaper: the screen material is renamed "Screen" and the
//     capture is drawn on it;
//   - the screen's UVs re-projected from its vertices, because a model's own
//     UVs wander by a few pixels and bend straight lines in a capture;
//   - no glass transmission, which makes three.js render the scene a second
//     time for a few pixels of lens;
//   - textures re-encoded (JPEG where there is no alpha, PNG where there is)
//     and capped at 512px: a handset is drawn a few hundred pixels tall here,
//     so this is re-encoding rather than throwing detail away;
//   - geometry simplified and quantized, and the credit kept in asset.extras.
//
// Not public/: models are served to signed-in users by
// src/app/api/models/[model]/route.ts (see ADR-004 for why).

import { createRequire } from "node:module";

const req = createRequire(`${process.cwd()}/`);
const load = (name) => import(req.resolve(name));
const { NodeIO } = await load("@gltf-transform/core");
const { ALL_EXTENSIONS } = await load("@gltf-transform/extensions");
const { prune, weld, simplifyPrimitive, quantize, dedup, textureCompress } = await load("@gltf-transform/functions");
const sharp = (await load("sharp")).default;
const { MeshoptSimplifier } = await load("meshoptimizer");

// Per model: the meshes to remove by material name, the material that becomes
// the screen, and how far each part is simplified — the share of triangles
// kept, and the largest deviation allowed relative to the part's size.
const MODELS = {
  "galaxy-s25": {
    source: '"SAMSUNG S25" by Yassine24, CC BY 4.0',
    // The SAMSUNG wordmark on the back is its own mesh.
    removeMeshes: ["S25_Body.002"],
    screen: "Wallpapers",
    // The camera glass was 55k of the model's 108k triangles and is drawn a
    // few pixels wide.
    keep: {
      "Glass.Camera": [0.08, 0.004],
      Camera: [0.25, 0.003],
      "Light.001": [0.1, 0.01],
      Light: [0.15, 0.01],
      S25_Body: [0.5, 0.0015],
      Frame: [0.5, 0.0015],
      Screen_Frame: [0.6, 0.0015],
    },
  },
  "iphone-16": {
    source: '"iPhone 16 Teal (Free)" by EV_car2013, CC BY 4.0',
    // Apple's logo STAYS: it fills a logo-shaped hole in the back panel, and
    // removing it leaves a recessed black logo. See ADR-004.
    removeMeshes: [],
    screen: "HdvBvHLgXAUNOwl",
    // Its screen UVs are all zero, so they are projected from the mesh; the
    // handset faces away from the viewer, hence "turn" in the registry.
    uv: { u: "+x", v: "-y" },
    defaultKeep: [0.22, 0.004],
    keep: {},
  },
  "iphone-13-pro-max": {
    source: '"Apple iPhone 13 Pro Max" by DatSketch, CC BY 4.0',
    // Apple's logo stays, as on the iPhone 16 (ADR-004). Here it is its own
    // mesh on an unbroken back, so it could be removed; the decision is the
    // same for both handsets rather than per model.
    removeMeshes: [],
    screen: "Wallpaper",
    // The notch is cut into the bezel that hangs in front of the display, so
    // that mesh keeps every triangle: simplifying it would round the notch off.
    never: ["Bezel"],
    uv: { u: "-x", v: "-y" },
    defaultKeep: [0.45, 0.003],
    keep: {},
  },
  "iphone-17-pro-max": {
    source: '"iPhone 17 Pro Max" by MG990, CC BY 4.0',
    removeMeshes: [],
    screen: "screen.001",
    // The Dynamic Island is cut into the screen itself, which is never
    // simplified anyway.
    never: [],
    // This model's screen is authored with its length along local z and its
    // width along local y — the axes are named in the mesh's own space, not
    // the world's.
    uv: { u: "-y", v: "-z" },
    defaultKeep: [0.5, 0.003],
    keep: {},
  },
};

const [id, input, output] = process.argv.slice(2);
const model = MODELS[id];
if (!model || !input || !output) {
  console.error(`usage: node optimise-handset-model.mjs <${Object.keys(MODELS).join("|")}> <download.glb> <out.glb>`);
  process.exit(2);
}
const KEEP = model.keep || {};
const DEFAULT_KEEP = model.defaultKeep || null;
// Never simplify a part this small: the saving is nothing and the shape is
// usually a lens ring or a button that reads as wrong immediately.
const LEAVE_ALONE = 300;

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(input);
const root = doc.getRoot();
const tris = () => root.listMeshes().flatMap((m) => m.listPrimitives())
  .reduce((n, p) => n + (p.getIndices()?.getCount() ?? p.getAttribute("POSITION").getCount()) / 3, 0);
console.log(`in:  ${tris()} triangles, ${root.listMaterials().length} materials, ${root.listTextures().length} textures`);

const material = (name) => {
  const m = root.listMaterials().find((x) => x.getName() === name);
  if (!m) throw new Error(`material ${name} not found — is this the right source model?`);
  return m;
};

// 1. Wordmarks and logos are their own meshes. Remove them.
for (const name of model.removeMeshes) {
  const branded = material(name);
  for (const node of root.listNodes()) {
    const mesh = node.getMesh();
    if (mesh && mesh.listPrimitives().some((p) => p.getMaterial() === branded)) {
      mesh.dispose();
      node.dispose();
    }
  }
}

// 2. The screen: drop Samsung's wallpaper (the app maps the capture there),
//    rename it so the code can find it, and replace its UVs. The source UVs
//    wander by up to ~3 CSS px, which bends straight lines in a capture; the
//    screen is flat, so a straight projection from its vertices is exact.
//    u runs with -x and v with +y in the mesh's own space, because the model's
//    node turns it 180° about z (check each model with a test pattern: not
//    mirrored, top at the top). The flat axis is found rather than assumed,
//    and which way u and v run is per model.
const screen = material(model.screen);
screen.setName("Screen")
  .setBaseColorTexture(null).setEmissiveTexture(null)
  .setBaseColorFactor([0, 0, 0, 1]).setEmissiveFactor([0, 0, 0]);
for (const mesh of root.listMeshes()) {
  for (const prim of mesh.listPrimitives()) {
    if (prim.getMaterial() !== screen) continue;
    const pos = prim.getAttribute("POSITION");
    const uv = prim.getAttribute("TEXCOORD_0");
    const min = pos.getMin([]), max = pos.getMax([]);
    const span = [0, 1, 2].map((i) => max[i] - min[i]);
    // The screen is flat: the axis it has no thickness in is the one to drop.
    const flat = span.indexOf(Math.min(...span));
    const [a, b] = [0, 1, 2].filter((i) => i !== flat);
    const want = model.uv || { u: "-x", v: "+y" };
    const axis = { x: 0, y: 1, z: 2 };
    const pick = (spec) => ({ i: axis[spec.slice(1)], flip: spec[0] === "-" });
    const U = pick(want.u), V = pick(want.v);
    if (![a, b].includes(U.i) || ![a, b].includes(V.i) || U.i === V.i) {
      throw new Error(`model ${id}: uv ${JSON.stringify(want)} does not match the screen's plane (flat axis ${"xyz"[flat]})`);
    }
    const along = (i, flip, p) => {
      const t = (p[i] - min[i]) / (max[i] - min[i]);
      return flip ? 1 - t : t;
    };
    const p = [];
    for (let i = 0; i < pos.getCount(); i++) {
      pos.getElement(i, p);
      uv.setElement(i, [along(U.i, U.flip, p), along(V.i, V.flip, p)]);
    }
    const uv1 = prim.getAttribute("TEXCOORD_1");
    if (uv1) { prim.setAttribute("TEXCOORD_1", null); uv1.dispose(); }
  }
}

// 3. The camera glass and flash cover were transmissive, which makes three.js
//    render the whole scene a second time for them. Plain alpha looks the same
//    at this size.
for (const m of root.listMaterials()) {
  if (m.getExtension("KHR_materials_transmission")) {
    m.setExtension("KHR_materials_transmission", null);
    m.setAlphaMode("BLEND");
  }
}

// Nothing else is textured, so nothing else needs UVs. The screen's are kept
// explicitly: it has no texture in the file, and a plain prune would drop them.
for (const mesh of root.listMeshes()) {
  for (const prim of mesh.listPrimitives()) {
    if (prim.getMaterial() === screen) continue;
    for (const name of prim.listSemantics().filter((s) => s.startsWith("TEXCOORD_"))) {
      const a = prim.getAttribute(name);
      prim.setAttribute(name, null);
      if (a.listParents().length === 1) a.dispose();
    }
  }
}

await doc.transform(prune({ keepAttributes: true }), dedup(), weld());

// 4. Simplify, part by part.
await MeshoptSimplifier.ready;
for (const mesh of root.listMeshes()) {
  for (const prim of mesh.listPrimitives()) {
    const matName = prim.getMaterial()?.getName();
    if (prim.getMaterial() === screen) continue;          // the screen's outline and its island cutout stay exact
    if ((model.never || []).includes(matName)) continue;  // …and anything else the model says shapes the handset
    const tris = (prim.getIndices()?.getCount() ?? prim.getAttribute("POSITION").getCount()) / 3;
    const k = KEEP[matName] ?? (tris > LEAVE_ALONE ? DEFAULT_KEEP : null);
    if (k) simplifyPrimitive(prim, { simplifier: MeshoptSimplifier, ratio: k[0], error: k[1] });
  }
}

// 5. Textures: the same pictures, far fewer bytes. One download's 512px PNG
//    normal map was 423 KB and is 26 KB as JPEG, with nothing visible lost at
//    the size a handset is drawn here. Base colour keeps PNG for its alpha.
//    Each texture is judged on its own: JPEG unless it actually uses alpha,
//    and the original is kept whenever re-encoding would be bigger.
for (const texture of root.listTextures()) {
  const before = texture.getImage();
  if (!before) continue;
  const opaque = (await sharp(before).stats()).isOpaque;
  const pipe = sharp(before).resize(512, 512, { fit: "inside", withoutEnlargement: true });
  const after = opaque ? await pipe.jpeg({ quality: 88 }).toBuffer() : await pipe.png().toBuffer();
  if (after.byteLength >= before.byteLength) continue;
  texture.setImage(after).setMimeType(opaque ? "image/jpeg" : "image/png");
}

// 6. Store positions, normals and UVs as small integers (KHR_mesh_quantization;
//    three.js reads it with no decoder).
await doc.transform(prune({ keepAttributes: true }), quantize());

for (const ext of root.listExtensionsUsed()) {
  if (!["KHR_mesh_quantization"].includes(ext.extensionName)) ext.dispose();
}
// CC BY 4.0 asks for changes to be indicated. The author, licence and source
// Sketchfab wrote into asset.extras are kept as they are.
const asset = root.getAsset();
asset.copyright = model.source;
asset.extras = {
  ...asset.extras,
  modified: `Apexure: ${model.removeMeshes.join(", ")} (wordmark/logo) and the wallpaper texture removed; `
    + "screen UVs re-projected; transmission removed; simplified and quantized for the web.",
};

console.log(`out: ${tris()} triangles, ${root.listMaterials().map((m) => m.getName()).join(", ")}; ${root.listTextures().length} textures`);
await io.write(output, doc);
