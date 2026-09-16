// One-off: turns a downloaded Sketchfab handset into assets/models/<id>.glb.
//
// Not part of the build, and gltf-transform is deliberately not a dependency of
// this app. To run it, install the tools in a scratch directory and run the
// script from there:
//
//   mkdir /tmp/gltf-tool && cd /tmp/gltf-tool && npm init -y
//   npm i @gltf-transform/core@4.5.0 @gltf-transform/extensions@4.5.0 \
//         @gltf-transform/functions@4.5.0 meshoptimizer@1.2.0
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
//   - geometry simplified and quantized, and the credit kept in asset.extras.
//
// Not public/: models are served to signed-in users by
// src/app/api/models/[model]/route.ts (see ADR-004 for why).

import { createRequire } from "node:module";

const req = createRequire(`${process.cwd()}/`);
const load = (name) => import(req.resolve(name));
const { NodeIO } = await load("@gltf-transform/core");
const { ALL_EXTENSIONS } = await load("@gltf-transform/extensions");
const { prune, weld, simplifyPrimitive, quantize, dedup } = await load("@gltf-transform/functions");
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
};

const [id, input, output] = process.argv.slice(2);
const model = MODELS[id];
if (!model || !input || !output) {
  console.error(`usage: node optimise-handset-model.mjs <${Object.keys(MODELS).join("|")}> <download.glb> <out.glb>`);
  process.exit(2);
}
const KEEP = model.keep;

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
//    mirrored, top at the top).
const screen = material(model.screen);
screen.setName("Screen")
  .setBaseColorTexture(null).setEmissiveTexture(null)
  .setBaseColorFactor([0, 0, 0, 1]).setEmissiveFactor([0, 0, 0]);
for (const mesh of root.listMeshes()) {
  for (const prim of mesh.listPrimitives()) {
    if (prim.getMaterial() !== screen) continue;
    const pos = prim.getAttribute("POSITION");
    const uv = prim.getAttribute("TEXCOORD_0");
    const [minX, minY] = pos.getMin([]), [maxX, maxY] = pos.getMax([]);
    const p = [];
    for (let i = 0; i < pos.getCount(); i++) {
      pos.getElement(i, p);
      uv.setElement(i, [(maxX - p[0]) / (maxX - minX), (p[1] - minY) / (maxY - minY)]);
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
    const k = KEEP[prim.getMaterial()?.getName()];
    if (k) simplifyPrimitive(prim, { simplifier: MeshoptSimplifier, ratio: k[0], error: k[1] });
  }
}

// 5. Store positions, normals and UVs as small integers (KHR_mesh_quantization;
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
