"use client";

import { useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import type * as THREE from "three";
import { cn } from "@/lib/utils";
import { cameraDistance } from "@/lib/layout-checks/model-fit";
import { screenCrop, scrollRange, toSourcePixels } from "@/lib/layout-checks/screen-crop";
import {
  clampToLimits, coast, dragged, driftOffset, DRIFT_DELAY_MS, facingFront, FRONT, isFront, LIMIT, releaseVelocity, settled, unresist,
  type Coast, type Rotation, type Sample,
} from "@/lib/layout-checks/model-rotation";
import { REDUCE_QUERY } from "@/lib/layout-checks/motion";
import { SCREEN_MATERIAL } from "@/lib/layout-checks/models-3d";

// A 3D handset, drawn in place of the CSS silhouette for the devices that have
// a model. It is there for feel, not for diagnosis: the capture, the pins and
// the scroll ruler in the flat frame are what the findings are read from.
//
// Which devices have one, who made each model and what was stripped from it:
// src/lib/layout-checks/models-3d.ts. Adding a handset is an entry there and
// an optimised file, not a second copy of this component.
//
// INTERNAL TOOLING ONLY — and the reason matters more than the instruction.
//
// The rule: if this tool ever becomes client-facing in any form (a client
// login, a client report or share link that shows the Devices tab, client
// material with a screenshot or recording of it, or a product), the 3D models
// come out first, before anything else about that change ships.
//
// The reason is the manufacturer's industrial design, not only its name.
// Stripping the wordmark does not make a model a generic phone: what makes it
// recognisably a Galaxy S25 — the flat-sided body and its proportions, three
// separate lenses stacked in the top-left corner with no camera island, the
// centred punch-hole — is Samsung's design, and manufacturers protect that
// separately from their trademarks (registered designs, design patents, trade
// dress). The same is true of every handset added here. A model's CC BY licence
// comes from the person who built the file. It licenses their work and nothing
// else: CC BY 4.0 says in terms that patent and trademark rights are not
// licensed, and it could not grant rights in a design that was never the
// modeller's to give. Used inside the company as a reference while checking a
// page, that is an ordinary thing to have. Shown to clients or shipped in a
// product, it would be our product presenting someone else's design and
// suggesting an association that does not exist. (This is the reasoning behind
// the rule, not legal advice; if the question ever becomes live, it goes to
// someone qualified to answer it.)
//
// The models reach the page only through /api/models/<file>, which checks the
// team session. Never put one in public/: that is outside the login, and the
// reason they are internal is the designs they show.
//
// They are also on trial, and come out if they get in the way of work. The
// conditions, the date to check them and how to remove all of this cleanly are
// in docs/decisions/ADR-004-3d-galaxy-s25-internal-only.md.

const FOV = 22;        // narrow, so the body is not distorted by perspective
// Share of the tighter side of the box the handset fills, fitted to the pose
// it is in: facing front it is the size of the flat frame it replaces, and the
// camera eases back only while it is turned. Short of 1 to leave the shadow room.
const FILL = 0.97;

/** What the page can ask of the model from outside it: the stage bar's button. */
export type ModelControls = { faceFront: () => void };

/** Drift is slow; half the display's frame rate is plenty, and half the work. */
const DRIFT_FRAME_MS = 1000 / 30;

/** The largest texture side the screen gets: sharper than the screen is ever
 *  drawn, and a 2048 × 946 texture is about 10 MB of GPU memory with mipmaps. */
const MAX_SCREEN_TEXTURE = 2048;

export function Handset3d({
  modelUrl,
  turn = 0,
  src,
  alt,
  viewport,
  className,
  ref,
  onCoverChange,
  onFrontChange,
  onScreenFail,
  onFail,
}: {
  /** The model for this device, from the registry: /api/models/<file>. */
  modelUrl: string;
  /** Degrees to turn the model so its screen faces the reader (registry). */
  turn?: number;
  /** The capture the flat frame is showing — the fold, then the full page
      once it arrives. Its first screen is drawn on the handset's screen. */
  src: string;
  /** What the capture is, for a screen reader: the flat frame is inert. */
  alt: string;
  /** The profile's viewport in CSS px: how much page one screen holds, and so
      how far the capture can be scrolled on it. */
  viewport: { width: number; height: number };
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
  const latestViewport = useRef(viewport);
  const [ready, setReady] = useState(false);
  // The callbacks are read through a ref so a parent re-rendering with new
  // functions does not tear the scene down and load it again.
  const callbacks = useRef({ onCoverChange, onFrontChange, onScreenFail, onFail });
  useEffect(() => { callbacks.current = { onCoverChange, onFrontChange, onScreenFail, onFail }; });
  // A new capture — the full page replacing the fold, or a new run — updates
  // the screen in place: no reload of the model, no change of angle.
  useEffect(() => { latestViewport.current = viewport; }, [viewport]);
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
      // The GPU can take the context away (a driver reset, too many contexts,
      // the machine sleeping). Nothing is drawn after that, so give the stage
      // back to the flat frame rather than leave a frozen or blank handset.
      // Registered after the renderer's release, so it is removed before our
      // own forceContextLoss() on unmount fires the same event.
      const onContextLost = () => { if (alive) callbacks.current.onFail?.("webgl-context-lost"); };
      cv.addEventListener("webglcontextlost", onContextLost);
      cleanups.push(() => cv.removeEventListener("webglcontextlost", onContextLost));
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

      const gltf = await new GLTFLoader().loadAsync(modelUrl);
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
      // The model's screen mesh (its UVs are re-projected by the optimiser
      // so the image lands straight). Unlit, because a screen gives off light
      // rather than reflecting it: the capture shows its own colours at any
      // angle. Black until the capture has loaded, though that is never seen:
      // the model stays hidden until it has.
      let screenMesh: THREE.Mesh | null = null;
      model.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh && !Array.isArray(m.material) && m.material.name === SCREEN_MATERIAL) screenMesh = m;
      });
      if (!screenMesh) throw new Error(`model-has-no-${SCREEN_MATERIAL}-material`);
      const screenBox = new T.Box3().setFromObject(screenMesh).getSize(new T.Vector3());
      const screenAspect = screenBox.x / screenBox.y;
      // Double-sided: a model's screen mesh may be authored facing either way,
      // and a single-sided replacement is culled on the ones facing away — the
      // handset then renders as a window straight through to its own back.
      const screenMat = new T.MeshBasicMaterial({ color: 0x000000, toneMapped: false, side: T.DoubleSide });
      const mesh: THREE.Mesh = screenMesh;
      (mesh.material as THREE.Material).dispose();
      mesh.material = screenMat;

      // A model exported facing away is turned once here, inside the pivot, so
      // "facing front" still means pose zero for every handset.
      model.rotation.set(0, (turn * Math.PI) / 180, 0, "XYZ");
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
      // Frames are requested only while something moves: a drag, a coast
      // after release, the turn back to front, or the idle drift (drawn at
      // 30 frames a second, and only once it has started). With reduced
      // motion there is no coast, no spring, no ease and no drift, so at rest
      // nothing is drawn at all. Drift also stops while the handset is
      // scrolled out of view, and the browser pauses frames in a hidden tab.
      type Mode = "idle" | "drag" | "coast" | "front";
      let mode: Mode = "idle";
      // The pose the reader put it in. Drift is added on top while idle and
      // folded in the moment anything else starts, so nothing ever jumps.
      let pose: Rotation = { ...FRONT };
      let coasting: Coast = { rot: pose, vel: { yaw: 0, pitch: 0 } };
      let frontFrom: Rotation = pose, frontAt = 0;
      let grab: { id: number; x: number; y: number; raw: Rotation } | null = null;
      let samples: Sample[] = [];
      let raf = 0, lastFrame = 0, lastDraw = 0, idleSince = performance.now(), reportedFront = true;
      let driftTimer = 0;
      let visible = true;
      // The model covers the flat frame only once the capture is on its
      // screen. Until then the frame is visible and says it is loading — a
      // handset with a black screen in its place would hide that.
      let covering = false;
      const motion = window.matchMedia(REDUCE_QUERY);
      let reduced = motion.matches;

      const drifting = () => mode === "idle" && !reduced && visible && covering;
      const view = (now: number): Rotation => {
        if (!drifting()) return pose;
        const d = driftOffset(now - idleSince);
        return { yaw: pose.yaw + d.yaw, pitch: pose.pitch + d.pitch };
      };
      const settle = (now: number) => { mode = "idle"; idleSince = now; };

      const fit = () => {
        const w = el.clientWidth, h = el.clientHeight;
        if (w === 0 || h === 0) return false;
        renderer.setSize(w, h, false);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        return true;
      };
      const draw = (now = performance.now()) => {
        const rad = Math.PI / 180;
        const r = view(now);
        camera.position.set(0, 0, cameraDistance({ width: size.x, height: size.y, depth: size.z }, FOV, camera.aspect, FILL, r));
        camera.lookAt(0, 0, 0);
        // XYZ: yaw is applied first, then pitch in world space, so a tip is
        // always towards the viewer whichever way the handset faces.
        pivot.rotation.set(r.pitch * rad, r.yaw * rad, 0, "XYZ");
        renderer.render(scene, camera);
        lastDraw = now;
        // "Facing front" is about the pose, not the sway on top of it.
        const front = mode === "idle" && isFront(pose);
        if (front !== reportedFront) { reportedFront = front; callbacks.current.onFrontChange?.(front); }
      };
      const frame = (now: number) => {
        raf = 0;
        const dt = lastFrame ? Math.min(50, now - lastFrame) : 1000 / 60;
        lastFrame = now;
        if (mode === "coast") {
          coasting = coast(coasting, dt);
          pose = coasting.rot;
          if (settled(coasting)) settle(now);
        } else if (mode === "front") {
          pose = facingFront(frontFrom, now - frontAt);
          if (isFront(pose)) { pose = { ...FRONT }; settle(now); }
        }
        const moving = mode === "coast" || mode === "front";
        // Swaying only once the delay is up; before that there is nothing new
        // to draw, so a timer waits for it instead of a loop of identical frames.
        const swaying = drifting() && now - idleSince >= DRIFT_DELAY_MS;
        if (moving || mode === "drag" || !swaying || now - lastDraw >= DRIFT_FRAME_MS) draw(now);
        if (moving || swaying) {
          raf = requestAnimationFrame(frame);
        } else {
          lastFrame = 0;
          window.clearTimeout(driftTimer);
          if (drifting()) driftTimer = window.setTimeout(kick, DRIFT_DELAY_MS - (now - idleSince) + 20);
        }
      };
      const kick = () => { if (!raf) raf = requestAnimationFrame(frame); };
      cleanups.push(() => { cancelAnimationFrame(raf); window.clearTimeout(driftTimer); });

      const onMotionPreference = () => {
        reduced = motion.matches;
        if (reduced) {
          // Whatever was moving stops where it should end up.
          if (mode === "coast") { pose = clampToLimits(coasting.rot); settle(performance.now()); }
          if (mode === "front") { pose = { ...FRONT }; settle(performance.now()); }
          draw();
        } else if (mode === "idle") {
          idleSince = performance.now();
          kick();
        }
      };
      motion.addEventListener("change", onMotionPreference);
      cleanups.push(() => motion.removeEventListener("change", onMotionPreference));

      const io = new IntersectionObserver(([entry]) => {
        const was = visible;
        visible = entry.isIntersecting;
        if (visible && !was && mode === "idle") { idleSince = performance.now(); kick(); }
      });
      io.observe(el);
      cleanups.push(() => io.disconnect());

      const onDown = (e: PointerEvent) => {
        if (grab || (e.pointerType === "mouse" && e.button !== 0)) return;
        el.setPointerCapture(e.pointerId);
        // Picked up mid-coast, mid-spring-back or mid-sway: carry on from
        // exactly what is on screen.
        pose = view(performance.now());
        const raw = { yaw: unresist(pose.yaw, LIMIT.yaw), pitch: unresist(pose.pitch, LIMIT.pitch) };
        grab = { id: e.pointerId, x: e.clientX, y: e.clientY, raw };
        samples = [{ t: e.timeStamp, rot: raw }];
        mode = "drag";
        el.dataset.dragging = "true";
        draw();
      };
      const onMove = (e: PointerEvent) => {
        if (!grab || e.pointerId !== grab.id) return;
        const next = dragged(grab.raw, e.clientX - grab.x, e.clientY - grab.y);
        pose = next.shown;
        samples.push({ t: e.timeStamp, rot: next.raw });
        if (samples.length > 32) samples = samples.slice(-16);
        kick();
      };
      const onUp = (e: PointerEvent) => {
        if (!grab || e.pointerId !== grab.id) return;
        grab = null;
        delete el.dataset.dragging;
        if (reduced) {
          // No throw and no spring: it stays where it was let go, inside the limits.
          pose = clampToLimits(pose);
          settle(performance.now());
          draw();
          return;
        }
        // A cancel (the browser took the gesture for a scroll) throws nothing.
        const vel = e.type === "pointercancel" ? { yaw: 0, pitch: 0 } : releaseVelocity(samples, e.timeStamp);
        coasting = { rot: pose, vel };
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
      // The capture now on the screen, and how far down the page it is
      // scrolled. Both are kept: scrolling redraws a different band of the
      // same image, and a capture that arrives later (the full page replacing
      // the fold) keeps the reader where they were.
      let shot: HTMLImageElement | null = null;
      let scrollCss = 0;
      let shotCanvas: HTMLCanvasElement | null = null;
      let shotTexture: THREE.CanvasTexture | null = null;
      const maxSide = Math.min(MAX_SCREEN_TEXTURE, renderer.capabilities.maxTextureSize);

      const putOnScreen = (tex: THREE.Texture) => {
        const old = screenMat.map;
        screenMat.map = tex;
        screenMat.color.setHex(0xffffff);
        screenMat.needsUpdate = true;
        if (old && old !== tex) old.dispose();
        draw();
        if (!covering) {
          covering = true;
          // The drift's clock starts when there is something to look at.
          idleSince = performance.now();
          kick();
          setReady(true);
          callbacks.current.onCoverChange?.(true);
        }
      };

      // Draw the band of the capture that the screen is showing. The canvas and
      // its texture are made once and redrawn in place, so scrolling uploads a
      // texture rather than building a new one every wheel tick.
      const paint = (img: HTMLImageElement): boolean => {
        const natural = { width: img.naturalWidth, height: img.naturalHeight };
        scrollCss = Math.max(0, Math.min(scrollRange(natural, latestViewport.current), scrollCss));
        const crop = screenCrop(natural, screenAspect, maxSide,
                               toSourcePixels(scrollCss, natural, latestViewport.current));
        if (!crop) return false;
        const canvas = shotCanvas ?? (shotCanvas = document.createElement("canvas"));
        const g = canvas.getContext("2d");
        if (!g) return false;
        if (canvas.width !== crop.width || canvas.height !== crop.height) {
          canvas.width = crop.width;
          canvas.height = crop.height;
          shotTexture?.dispose();
          shotTexture = null;
        }
        // White under a page shorter than the screen, as the flat frame has.
        g.fillStyle = "#ffffff";
        g.fillRect(0, 0, canvas.width, canvas.height);
        g.imageSmoothingQuality = "high";
        g.drawImage(img, 0, crop.sourceTop, crop.sourceWidth, crop.sourceHeight,
                    0, 0, crop.width, crop.drawnHeight);
        if (shotTexture) {
          shotTexture.needsUpdate = true;
          draw();
        } else {
          shotTexture = new T.CanvasTexture(canvas);
          shotTexture.colorSpace = T.SRGBColorSpace;
          shotTexture.flipY = false;   // glTF's UVs put v = 0 at the top of the image
          shotTexture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
          putOnScreen(shotTexture);
        }
        return true;
      };

      // The wheel scrolls the capture, and only while there is capture left to
      // scroll: a stored fold is one screen, and at the top and the foot of a
      // full page the wheel belongs to the Dashboard page behind it. Work must
      // not get stuck under the handset.
      const onWheel = (e: WheelEvent) => {
        if (!shot) return;
        const natural = { width: shot.naturalWidth, height: shot.naturalHeight };
        const range = scrollRange(natural, latestViewport.current);
        if (range <= 0) return;
        const lines = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? latestViewport.current.height : 1;
        const next = Math.max(0, Math.min(range, scrollCss + e.deltaY * lines));
        if (next === scrollCss) return;
        e.preventDefault();
        scrollCss = next;
        paint(shot);
      };
      el.addEventListener("wheel", onWheel, { passive: false });
      cleanups.push(() => el.removeEventListener("wheel", onWheel));

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
            shot = img;
            if (!paint(img)) failed();
          };
          img.onerror = () => { pending = null; failed(); };
          img.src = url;
        },
      };
      cleanups.push(() => {
        screen.current = null;
        shot = null;
        if (pending) { pending.onload = null; pending.onerror = null; }
      });

      controls.current = {
        faceFront: () => {
          if (grab || (mode === "idle" && isFront(pose))) return;
          if (reduced) { pose = { ...FRONT }; settle(performance.now()); draw(); return; }
          frontFrom = view(performance.now());
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
    // A different handset is a different model: tear the scene down and load it.
  }, [modelUrl, turn]);

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
