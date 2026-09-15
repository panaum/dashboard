"use client";

import { useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import type * as THREE from "three";
import { cn } from "@/lib/utils";
import { cameraDistance } from "@/lib/layout-checks/model-fit";
import { screenCrop } from "@/lib/layout-checks/screen-crop";
import {
  coast, dragged, facingFront, FRONT, isFront, LIMIT, releaseVelocity, settled, unresist,
  type Coast, type Rotation, type Sample,
} from "@/lib/layout-checks/model-rotation";

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
// Share of the tighter side of the box the handset fills, fitted to the pose
// it is in: facing front it is the size of the flat frame it replaces, and the
// camera eases back only while it is turned. Short of 1 to leave the shadow room.
const FILL = 0.97;

/** What the page can ask of the model from outside it: the stage bar's button. */
export type ModelControls = { faceFront: () => void };

/** The largest texture side the screen gets: sharper than the screen is ever
 *  drawn, and a 2048 × 946 texture is about 10 MB of GPU memory with mipmaps. */
const MAX_SCREEN_TEXTURE = 2048;

export function GalaxyS25Model({
  src,
  alt,
  className,
  ref,
  onCoverChange,
  onFrontChange,
  onScreenFail,
  onFail,
}: {
  /** The capture the flat frame is showing — the fold, then the full page
      once it arrives. Its first screen is drawn on the handset's screen. */
  src: string;
  /** What the capture is, for a screen reader: the flat frame is inert. */
  alt: string;
  className?: string;
  ref?: Ref<ModelControls>;
  /** True once the handset is drawn with the capture on its screen — from
      then it covers the flat frame, which must stop taking focus. False again
      when it unmounts. */
  onCoverChange?: (covering: boolean) => void;
  /** Whether the handset is at rest facing the viewer. */
  onFrontChange?: (front: boolean) => void;
  /** The capture could not be loaded or drawn. The flat frame has something
      to say about that (a fallback, or "no longer stored"), so step aside. */
  onScreenFail?: (src: string) => void;
  /** No WebGL, or the model could not be loaded. The flat frame stays. */
  onFail?: (reason: string) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const controls = useRef<ModelControls | null>(null);
  // The scene is built once; a new capture reaches it through this.
  const screen = useRef<{ show: (url: string) => void } | null>(null);
  const latestSrc = useRef(src);
  const [ready, setReady] = useState(false);
  // The callbacks are read through a ref so a parent re-rendering with new
  // functions does not tear the scene down and load it again.
  const callbacks = useRef({ onCoverChange, onFrontChange, onScreenFail, onFail });
  useEffect(() => { callbacks.current = { onCoverChange, onFrontChange, onScreenFail, onFail }; });
  // A new capture — the full page replacing the fold, or a new run — updates
  // the screen in place: no reload of the model, no change of angle.
  useEffect(() => {
    latestSrc.current = src;
    screen.current?.show(src);
  }, [src]);
  useImperativeHandle(ref, () => ({ faceFront: () => controls.current?.faceFront() }), []);

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
      const env = pmrem.fromScene(room, 0.04);
      room.dispose();
      pmrem.dispose();
      cleanups.push(() => env.dispose());
      scene.environment = env.texture;
      scene.environmentIntensity = 0.9;

      // Key from the upper right, fill from the left. They stay where they
      // are while the handset turns, so its highlights move across it.
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
      const box = new T.Box3().setFromObject(model);
      const size = box.getSize(new T.Vector3());
      model.position.sub(box.getCenter(new T.Vector3()));
      // The handset turns about its own centre: the pivot sits there and the
      // model is centred inside it.

      // ── The screen ─────────────────────────────────────────────────────
      // The model's "Screen" mesh (see the header: its UVs are re-projected
      // so the image lands straight). Unlit, because a screen gives off light
      // rather than reflecting it: the capture shows its own colours at any
      // angle. Black until the capture has loaded, though that is never seen:
      // the model stays hidden until it has.
      let screenMesh: THREE.Mesh | null = null;
      model.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh && !Array.isArray(m.material) && m.material.name === "Screen") screenMesh = m;
      });
      if (!screenMesh) throw new Error("model-has-no-screen");
      const screenBox = new T.Box3().setFromObject(screenMesh).getSize(new T.Vector3());
      const screenAspect = screenBox.x / screenBox.y;
      const screenMat = new T.MeshBasicMaterial({ color: 0x000000, toneMapped: false });
      const mesh: THREE.Mesh = screenMesh;
      (mesh.material as THREE.Material).dispose();
      mesh.material = screenMat;

      const pivot = new T.Group();
      pivot.add(model);
      scene.add(pivot);

      // A soft shadow under the body: a blurred ellipse on the floor rather
      // than a shadow map, which would cost a render pass to draw a sliver.
      // It does not turn with the handset.
      const shadowTex = contactShadow(T);
      const shadow = new T.Mesh(
        new T.PlaneGeometry(size.x * 1.7, size.x * 0.6),
        new T.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false, toneMapped: false }),
      );
      shadow.rotation.set(-Math.PI / 2, 0, 0);
      shadow.position.set(0, -size.y / 2 - 0.005, 0);
      scene.add(shadow);

      // ── Turning ────────────────────────────────────────────────────────
      // There is no animation loop running at rest. A frame is requested
      // when something moves — a drag, a coast after release, the turn back
      // to front — and the chain of frames stops when that motion settles.
      type Mode = "idle" | "drag" | "coast" | "front";
      let mode: Mode = "idle";
      let shown: Rotation = { ...FRONT };
      let coasting: Coast = { rot: shown, vel: { yaw: 0, pitch: 0 } };
      let frontFrom: Rotation = shown, frontAt = 0;
      let grab: { id: number; x: number; y: number; raw: Rotation } | null = null;
      let samples: Sample[] = [];
      let raf = 0, lastFrame = 0, reportedFront = true;

      const fit = () => {
        const w = el.clientWidth, h = el.clientHeight;
        if (w === 0 || h === 0) return false;
        renderer.setSize(w, h, false);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        return true;
      };
      const draw = () => {
        const rad = Math.PI / 180;
        camera.position.set(0, 0, cameraDistance({ width: size.x, height: size.y, depth: size.z }, FOV, camera.aspect, FILL, shown));
        camera.lookAt(0, 0, 0);
        // XYZ: yaw is applied first, then pitch in world space, so a tip is
        // always towards the viewer whichever way the handset faces.
        pivot.rotation.set(shown.pitch * rad, shown.yaw * rad, 0, "XYZ");
        renderer.render(scene, camera);
        const front = mode === "idle" && isFront(shown);
        if (front !== reportedFront) { reportedFront = front; callbacks.current.onFrontChange?.(front); }
      };
      const frame = (now: number) => {
        raf = 0;
        const dt = lastFrame ? Math.min(50, now - lastFrame) : 1000 / 60;
        lastFrame = now;
        if (mode === "coast") {
          coasting = coast(coasting, dt);
          shown = coasting.rot;
          if (settled(coasting)) mode = "idle";
        } else if (mode === "front") {
          shown = facingFront(frontFrom, now - frontAt);
          if (isFront(shown)) { shown = { ...FRONT }; mode = "idle"; }
        }
        draw();
        if (mode === "coast" || mode === "front") raf = requestAnimationFrame(frame);
        else lastFrame = 0;
      };
      const kick = () => { if (!raf) raf = requestAnimationFrame(frame); };
      cleanups.push(() => cancelAnimationFrame(raf));

      const onDown = (e: PointerEvent) => {
        if (grab || (e.pointerType === "mouse" && e.button !== 0)) return;
        el.setPointerCapture(e.pointerId);
        // Picked up mid-coast or mid-spring-back: carry on from where it is.
        const raw = { yaw: unresist(shown.yaw, LIMIT.yaw), pitch: unresist(shown.pitch, LIMIT.pitch) };
        grab = { id: e.pointerId, x: e.clientX, y: e.clientY, raw };
        samples = [{ t: e.timeStamp, rot: raw }];
        mode = "drag";
        el.dataset.dragging = "true";
        draw();
      };
      const onMove = (e: PointerEvent) => {
        if (!grab || e.pointerId !== grab.id) return;
        const next = dragged(grab.raw, e.clientX - grab.x, e.clientY - grab.y);
        shown = next.shown;
        samples.push({ t: e.timeStamp, rot: next.raw });
        if (samples.length > 32) samples = samples.slice(-16);
        kick();
      };
      const onUp = (e: PointerEvent) => {
        if (!grab || e.pointerId !== grab.id) return;
        grab = null;
        delete el.dataset.dragging;
        // A cancel (the browser took the gesture for a scroll) throws nothing.
        const vel = e.type === "pointercancel" ? { yaw: 0, pitch: 0 } : releaseVelocity(samples, e.timeStamp);
        coasting = { rot: shown, vel };
        mode = "coast";
        lastFrame = 0;
        kick();
      };
      el.addEventListener("pointerdown", onDown);
      el.addEventListener("pointermove", onMove);
      el.addEventListener("pointerup", onUp);
      el.addEventListener("pointercancel", onUp);
      cleanups.push(() => {
        el.removeEventListener("pointerdown", onDown);
        el.removeEventListener("pointermove", onMove);
        el.removeEventListener("pointerup", onUp);
        el.removeEventListener("pointercancel", onUp);
      });

      let screenToken = 0;
      let pending: HTMLImageElement | null = null;
      const maxSide = Math.min(MAX_SCREEN_TEXTURE, renderer.capabilities.maxTextureSize);
      // The model covers the flat frame only once the capture is on its
      // screen. Until then the frame is visible and says it is loading — a
      // handset with a black screen in its place would hide that.
      let covering = false;
      const putOnScreen = (tex: THREE.Texture) => {
        const old = screenMat.map;
        screenMat.map = tex;
        screenMat.color.setHex(0xffffff);
        screenMat.needsUpdate = true;
        old?.dispose();
        draw();
        if (!covering) {
          covering = true;
          setReady(true);
          callbacks.current.onCoverChange?.(true);
        }
      };
      screen.current = {
        show: (url) => {
          // Only the newest capture may land: a slow fold must not overwrite
          // the full page that arrived after it.
          const token = ++screenToken;
          if (pending) { pending.onload = null; pending.onerror = null; }
          const img = new Image();
          pending = img;
          const failed = () => { if (alive && token === screenToken) callbacks.current.onScreenFail?.(url); };
          img.onload = () => {
            pending = null;
            if (!alive || token !== screenToken) return;
            const crop = screenCrop({ width: img.naturalWidth, height: img.naturalHeight }, screenAspect, maxSide);
            const c = document.createElement("canvas");
            const g = crop ? c.getContext("2d") : null;
            if (!crop || !g) { failed(); return; }
            c.width = crop.width;
            c.height = crop.height;
            g.fillStyle = "#ffffff";
            g.fillRect(0, 0, c.width, c.height);
            g.imageSmoothingQuality = "high";
            g.drawImage(img, 0, 0, crop.sourceWidth, crop.sourceHeight, 0, 0, crop.width, crop.drawnHeight);
            const tex = new T.CanvasTexture(c);
            tex.colorSpace = T.SRGBColorSpace;
            tex.flipY = false;   // glTF's UVs put v = 0 at the top of the image
            tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
            putOnScreen(tex);
          };
          img.onerror = () => { pending = null; failed(); };
          img.src = url;
        },
      };
      cleanups.push(() => {
        screen.current = null;
        if (pending) { pending.onload = null; pending.onerror = null; }
      });

      controls.current = {
        faceFront: () => {
          if (grab || (mode === "idle" && isFront(shown))) return;
          frontFrom = shown;
          frontAt = performance.now();
          mode = "front";
          lastFrame = 0;
          kick();
        },
      };
      cleanups.push(() => { controls.current = null; });

      // Redrawn when the box changes size, at whatever angle it is.
      const ro = new ResizeObserver(() => { if (fit()) draw(); });
      ro.observe(el);
      cleanups.push(() => ro.disconnect());

      if (fit()) draw();
      cleanups.push(() => { if (covering) callbacks.current.onCoverChange?.(false); });
      screen.current.show(latestSrc.current);
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
    <div
      ref={host}
      role="img"
      aria-label={`${alt}, on a 3D model. Drag to turn it.`}
      className={cn("cursor-grab touch-pan-y select-none data-[dragging=true]:cursor-grabbing", className, !ready && "invisible")}
    >
      <canvas ref={canvas} aria-hidden className="block size-full" />
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
