"use client";

import { useEffect, useRef, useState } from "react";
import type * as THREE from "three";
import { cn } from "@/lib/utils";
import { cameraDistance } from "@/lib/layout-checks/model-fit";

// A 3D Galaxy S25, drawn in place of the CSS silhouette for that one handset.
// It is there for feel, not for diagnosis: the capture, the pins and the
// scroll ruler in the flat frame are what the findings are read from.
//
// INTERNAL TOOLING ONLY. The model is a third-party asset of a real, branded
// handset. If this tool ever goes client-facing or becomes a product, the 3D
// model is the first thing that has to come out.
//
// The model
// ---------
// Source: "SAMSUNG S25" by Yassine24, CC Attribution 4.0 —
//   https://sketchfab.com/3d-models/samsung-s25-3ea821af958f4e9d99aaba1eb32b423f
//   https://creativecommons.org/licenses/by/4.0/
// The credit is also kept inside the file (asset.copyright and asset.extras).
//
// public/models/galaxy-s25.glb is NOT the file Sketchfab serves. It was made
// from it by scripts/optimise-galaxy-s25-model.mjs, which:
//   - removes the SAMSUNG wordmark on the back (its own mesh). No trademarks
//     on a tool that might not stay internal, and nobody should have to find
//     and undo a branded model later;
//   - removes Samsung's wallpaper from the screen and renames that material
//     "Screen" — the capture is drawn there instead;
//   - re-projects the screen's UVs from its vertices, because the originals
//     wander by up to ~3 CSS px and bend straight lines in a capture;
//   - drops the glass's transmission, which made three.js render the scene a
//     second time for a few pixels of lens;
//   - simplifies it (108,208 → 21,574 triangles; the camera glass alone was
//     55k) and quantizes it: 3.54 MB → 429 KB.
// Re-importing the download untouched brings all of that back. Re-run the
// script instead.

export const MODEL_DEVICE = "galaxy-s25";
const MODEL_URL = "/models/galaxy-s25.glb";

const FOV = 22;        // narrow, so the body is not distorted by perspective
const FILL = 0.94;     // share of the tighter side of the box: close to the flat frame, room for the shadow

export function GalaxyS25Model({
  className,
  onReady,
  onFail,
}: {
  className?: string;
  /** The model has loaded and its first frame is on the canvas. */
  onReady?: () => void;
  /** No WebGL, or the model could not be loaded. The flat frame stays. */
  onFail?: (reason: string) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false);
  // The callbacks are read through a ref so a parent re-rendering with new
  // functions does not tear the scene down and load it again.
  const callbacks = useRef({ onReady, onFail });
  useEffect(() => { callbacks.current = { onReady, onFail }; });

  useEffect(() => {
    const el = host.current, cv = canvas.current;
    if (!el || !cv) return;
    let alive = true;
    // Each GPU resource registers its own release as soon as it exists, so a
    // failure halfway through (the model 404s) frees what was made before it.
    const cleanups: (() => void)[] = [];
    const release = () => { while (cleanups.length) cleanups.pop()!(); };

    (async () => {
      // three.js is loaded here, not at the top of the file, so it is fetched
      // only when a 3D view is actually mounted.
      const [T, { GLTFLoader }, { RoomEnvironment }] = await Promise.all([
        import("three"),
        import("three/addons/loaders/GLTFLoader.js"),
        import("three/addons/environments/RoomEnvironment.js"),
      ]);
      if (!alive) return;

      let renderer: THREE.WebGLRenderer;
      try {
        renderer = new T.WebGLRenderer({ canvas: cv, antialias: true, alpha: true, powerPreference: "low-power" });
      } catch {
        throw new Error("webgl-unavailable");
      }
      cleanups.push(() => { renderer.dispose(); renderer.forceContextLoss(); });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.setClearColor(0x000000, 0);
      renderer.outputColorSpace = T.SRGBColorSpace;
      renderer.toneMapping = T.ACESFilmicToneMapping;

      const scene = new T.Scene();
      cleanups.push(() => disposeScene(scene));
      // The body is metal, and metal shows what it reflects: with no
      // environment the frame renders nearly black.
      const pmrem = new T.PMREMGenerator(renderer);
      const room = new RoomEnvironment();
      const envMap = pmrem.fromScene(room, 0.04).texture;
      room.dispose();
      pmrem.dispose();
      cleanups.push(() => envMap.dispose());
      scene.environment = envMap;
      scene.environmentIntensity = 0.9;

      // Key from the upper right, fill from the left.
      const key = new T.DirectionalLight(0xffffff, 2);
      key.position.set(3, 4, 6);
      const fill = new T.DirectionalLight(0xffffff, 0.5);
      fill.position.set(-5, 1, 3);
      scene.add(key, fill);

      const camera = new T.PerspectiveCamera(FOV, 1, 0.1, 100);

      const gltf = await new GLTFLoader().loadAsync(MODEL_URL);
      const model = gltf.scene;
      // Unmounted while the model was on its way: everything else is already
      // released, so this is the only thing left to free.
      if (!alive) { disposeScene(model); return; }
      scene.add(model);
      const box = new T.Box3().setFromObject(model);
      const size = box.getSize(new T.Vector3());
      model.position.sub(box.getCenter(new T.Vector3()));

      // A soft shadow under the body: a blurred ellipse on the floor rather
      // than a shadow map, which would cost a render pass to draw a sliver.
      const shadowTex = contactShadow(T);
      const shadow = new T.Mesh(
        new T.PlaneGeometry(size.x * 1.7, size.x * 0.9),
        new T.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false, toneMapped: false }),
      );
      shadow.rotation.x = -Math.PI / 2;
      shadow.position.y = -size.y / 2 - 0.005;
      scene.add(shadow);

      const draw = () => {
        const w = el.clientWidth, h = el.clientHeight;
        if (w === 0 || h === 0) return;
        renderer.setSize(w, h, false);
        camera.aspect = w / h;
        camera.position.set(0, 0, cameraDistance({ width: size.x, height: size.y, depth: size.z }, FOV, w / h, FILL));
        camera.lookAt(0, 0, 0);
        camera.updateProjectionMatrix();
        renderer.render(scene, camera);
      };
      // Nothing moves, so there is no animation loop: a frame is drawn when
      // the model arrives and again when the box changes size.
      const ro = new ResizeObserver(draw);
      ro.observe(el);
      cleanups.push(() => ro.disconnect());

      draw();
      setReady(true);
      callbacks.current.onReady?.();
    })().catch((e: unknown) => {
      release();
      if (!alive) return;
      callbacks.current.onFail?.(e instanceof Error ? e.message : String(e));
    });

    return () => {
      alive = false;
      release();
    };
  }, []);

  return (
    <div ref={host} aria-hidden className={cn(className, !ready && "invisible")}>
      <canvas ref={canvas} className="block size-full" />
    </div>
  );
}

// A radial fade from the page's text colour (text-primary, #1c1c2e) to nothing.
function contactShadow(T: typeof THREE): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d");
  if (g) {
    const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grad.addColorStop(0, "rgba(28, 28, 46, 0.32)");
    grad.addColorStop(0.45, "rgba(28, 28, 46, 0.14)");
    grad.addColorStop(1, "rgba(28, 28, 46, 0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
  }
  const tex = new T.CanvasTexture(c);
  tex.colorSpace = T.SRGBColorSpace;
  return tex;
}

// Everything under `root` that holds GPU memory: geometry, materials, and any
// texture a material points at. The renderer is released separately.
function disposeScene(root: THREE.Object3D) {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry.dispose();
    for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      for (const v of Object.values(m)) {
        if (v && typeof v === "object" && (v as THREE.Texture).isTexture) (v as THREE.Texture).dispose();
      }
      m.dispose();
    }
  });
}
