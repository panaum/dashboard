"use client";

import React, { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { ImageOff, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Shape } from "@/lib/layout-checks/devices-view";
import { ms } from "@/lib/layout-checks/motion";
import { placePins, type Pin } from "@/lib/layout-checks/pins";
import { useStageHeight } from "@/components/layout-checks/check-shell";
import { cutoutBox, skinFor } from "@/lib/layout-checks/device-skin";
import { bandFor, clusterDots, scrollForThumb, worthMapping } from "@/lib/layout-checks/minimap";

// A generic frame per platform — a bezelled rounded rectangle for phones, a
// wider one for tablets, a browser chrome bar for desktop — sized to the
// selected viewport's aspect ratio and scaled to fit. Not handset-accurate:
// a notch tells the reader nothing. The frame's width and height transition
// (~200ms) when the selection changes shape, and only the image inside
// crossfades (150ms); the frame stays put.

const BODY = "#15181e";        // the handset body
const HARDWARE = "#31363f";    // buttons, and the SE's earpiece
const CHROME_H = 34;          // the desktop title bar
const MAP_W = 10;             // the overview ruler beside the body
const MAP_GAP = 12;
const FADE_MS = 150;

// `tried` — the fallback has already been swapped in, so a second error is
// the end of the road. `dead` — nothing loaded and nothing left to try.
type Layer = { key: number; src: string; loaded: boolean; tried: boolean; dead: boolean };
export type Box = { x: number; y: number; width: number; height: number };

/** A pin drawn on the capture: the number the list shows beside the same finding. */
export type PinMarker = Pin & { label: string };

const PIN_TONE: Record<PinMarker["severity"], string> = {
  error: "bg-error", warn: "bg-warning", info: "bg-text-muted",
};

export function DeviceFrame({
  shape,
  deviceId = null,
  viewport,
  scaleRef,
  src,
  fallbackSrc,
  upgradeSrc = null,
  liveSrc = null,
  alt,
  title,
  maxHeight = 640,
  highlight = null,
  onImageMeta,
  frameClassName,
  zoom = "fit",
  pins = [],
  onPinSelect,
  selectedPin = null,
  minimap = false,
  onShown,
  onPartial,
  children,
}: {
  shape: Shape;
  /** The profile this capture came from, so the body drawn is that device's.
      Widths have no device and get a plain frame for their shape. */
  deviceId?: string | null;
  viewport: { width: number; height: number };
  /** Receives the CSS-px → screen-px scale so overlays can be placed. */
  scaleRef?: (scale: number) => void;
  src: string | null;
  fallbackSrc?: string | null;
  /** A taller image to swap in once it has loaded — silently, and never shown
      as an error, because `src` is already a correct answer. */
  upgradeSrc?: string | null;
  /** The real page, loaded in the frame instead of a capture of it. */
  liveSrc?: string | null;
  alt: string;
  title?: string;
  /** A number of CSS px, or "fill" to take the height the stage has. */
  maxHeight?: number | "fill";
  /** A finding's box in CSS px of the page; drawn over the image and scrolled into view. */
  highlight?: Box | null;
  /** Reports the loaded image's height in CSS px (null while nothing is loaded). */
  onImageMeta?: (meta: { cssHeight: number } | null) => void;
  /** Extra classes on the bezel — a light halo when the frame sits on a dark stage. */
  frameClassName?: string;
  /** "actual" pins the capture at 1:1, so 11px text is 11px on screen. */
  zoom?: "fit" | "actual";
  /** Numbered markers over the findings that were measured somewhere. */
  pins?: PinMarker[];
  onPinSelect?: (id: string) => void;
  selectedPin?: string | null;
  /** Draw the page map beside the body when the page is taller than the window. */
  minimap?: boolean;
  /** The image the frame is actually showing (fold, then the full page once
      it arrives) — so the rail can crop its thumbnails from the same one. */
  onShown?: (src: string | null) => void;
  /** True while the frame is showing only the fold because the full page was
      asked for and could not be had — so the caption can say so. */
  onPartial?: (partial: boolean) => void;
  children?: ReactNode;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [avail, setAvail] = useState(0);
  useLayoutEffect(() => {
    const el = host.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setAvail(e.contentRect.width));
    ro.observe(el);
    setAvail(el.getBoundingClientRect().width);
    return () => ro.disconnect();
  }, []);

  const skin = skinFor(deviceId, shape);
  const chrome = shape === "desktop" ? CHROME_H : 0;
  const room = useStageHeight();
  const ceiling = maxHeight === "fill" ? (room ?? 640) : maxHeight;
  // The map's column is reserved whenever it may appear, so the body does not
  // shift the moment a tall page finishes loading.
  const maxW = Math.max(0, avail - 2 * skin.bezelX - (minimap ? MAP_W + MAP_GAP : 0));
  const maxH = Math.max(0, ceiling - skin.bezelTop - skin.bezelBottom - chrome);
  // "Fit" is the frame the column can hold; "actual" is the page's own pixels,
  // which is the only way to judge whether 11px text or a 24px target really
  // is too small. At 1:1 the frame may be wider than the column and the stage
  // scrolls to it.
  const fit = avail > 0 ? Math.min(maxW / viewport.width, maxH / viewport.height) : 0;
  const scale = zoom === "actual" ? (avail > 0 ? 1 : 0) : fit;
  const screenW = Math.round(viewport.width * scale);
  const screenH = Math.round(viewport.height * scale);
  useEffect(() => { scaleRef?.(scale); }, [scale, scaleRef]);
  const sized = scale > 0;

  // Crossfade: the new image mounts on top at opacity 0 and fades in once it
  // has loaded; the previous one is dropped after the fade. A source that
  // fails (the service pruned the run) is replaced by the stored fold.
  // Two images answer the same question at different costs. The fold is in our
  // own database and paints in a couple of seconds; the full page is on the
  // preview service, which is slower and, after two runs of a site, no longer
  // has it at all. So paint the fold and fetch the full page behind it: when
  // it arrives it crossfades in and the findings below the fold become
  // drawable, and when it does not, nothing happens — the fold was never
  // wrong, only shorter.
  const [up, setUp] = useState<{ base: string; url: string } | null>(null);
  // The full page was asked for and refused: the fold is all there is, and
  // the frame must not pretend a one-screen capture is the whole page.
  const [upFailed, setUpFailed] = useState<string | null>(null);
  useEffect(() => {
    if (!src || !upgradeSrc || upgradeSrc === src) return;
    const img = new Image();
    let alive = true;
    img.onload = () => { if (alive) setUp({ base: src, url: upgradeSrc }); };
    img.onerror = () => { if (alive) setUpFailed(src); };
    img.src = upgradeSrc;
    return () => { alive = false; img.onload = null; img.onerror = null; };
  }, [src, upgradeSrc]);
  const shown = up && up.base === src ? up.url : src;
  useEffect(() => { onShown?.(shown); }, [shown, onShown]);
  const partial = Boolean(src && upgradeSrc && upgradeSrc !== src && shown === src && upFailed === src);
  useEffect(() => { onPartial?.(partial); }, [partial, onPartial]);

  const [layers, setLayers] = useState<Layer[]>(() => shown ? [{ key: 0, src: shown, loaded: false, tried: false, dead: false }] : []);
  const keyRef = useRef(0);
  useEffect(() => {
    setLayers((ls) => {
      const top = ls[ls.length - 1];
      if (top && top.src === shown) return ls;
      if (!shown) return [];
      keyRef.current += 1;
      return [...ls.slice(-1), { key: keyRef.current, src: shown, loaded: false, tried: false, dead: false }];
    });
  }, [shown]);
  const screenRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  // The size transition belongs to a change of selection and to nothing else.
  // It is switched on for that change only, so arriving at the page, the
  // column settling and a window resize are all instant — an animation the
  // reader did not ask for reads as lag. `transition` is deliberately absent
  // from the style props below, so React never overwrites what is set here.
  const shownViewport = useRef<string | null>(null);
  useLayoutEffect(() => {
    const sig = `${viewport.width}x${viewport.height}`;
    const was = shownViewport.current;
    shownViewport.current = sig;
    const el = frameRef.current, sc = screenRef.current;
    if (!el || !sc || was === null || was === sig || ms(200) === 0) return;
    el.style.transition = "width 200ms ease, height 200ms ease, border-radius 200ms ease";
    sc.style.transition = "width 200ms ease, height 200ms ease";
    const t = window.setTimeout(() => { el.style.transition = ""; sc.style.transition = ""; }, 240);
    return () => window.clearTimeout(t);
  }, [viewport.width, viewport.height]);
  const [cssHeight, setCssHeight] = useState<number | null>(null);
  const settle = (key: number, img: HTMLImageElement) => {
    // The image is viewport.width CSS px wide by construction, so its pixel
    // size gives the page height it covers — the fold, or the whole page.
    const h = img.naturalWidth ? Math.round(img.naturalHeight * viewport.width / img.naturalWidth) : null;
    setCssHeight(h);
    onImageMeta?.(h === null ? null : { cssHeight: h });
    setLayers((ls) => ls.map((l) => (l.key === key ? { ...l, loaded: true } : l)));
    window.setTimeout(() => setLayers((ls) => (ls.length > 1 && ls[ls.length - 1].key === key ? ls.slice(-1) : ls)), FADE_MS + 30);
  };
  // The full page lives on the preview service and is pruned after a couple
  // of runs; the fold lives in our own database. So a 503 here is ordinary,
  // and the fold is the answer. When there is no fold either, the frame has
  // to say so — a white rectangle is not an answer.
  const fail = (key: number) => {
    setLayers((ls) => ls.map((l) => {
      if (l.key !== key) return l;
      if (!l.tried && fallbackSrc && fallbackSrc !== l.src) return { ...l, src: fallbackSrc, tried: true };
      return { ...l, dead: true };
    }));
  };

  // An <img> in server-rendered HTML starts loading before React hydrates, so
  // its load or error can land before the handlers below are attached — and a
  // missed error meant the fallback never fired and the frame stayed blank for
  // good. After every render, ask the DOM what actually happened to anything
  // still marked pending, which is the one source that cannot race us.
  const imgs = useRef(new Map<number, HTMLImageElement>());
  useEffect(() => {
    for (const l of layers) {
      if (l.loaded || l.dead) continue;
      const el = imgs.current.get(l.key);
      if (!el || !el.complete) continue;
      if (el.naturalWidth > 0) settle(l.key, el);
      else fail(l.key);
    }
  });

  const cut = cutoutBox(skin, screenW);

  // Where the window is on the page, for the map. Read on scroll, one state
  // update per frame at most; the div itself is the truth in between.
  // Read from the scroll container, never derived: its scrollHeight is the
  // truth about how much page there is, whatever the image maths say, and
  // clientHeight is the window. One state update per frame at most.
  const [scroll, setScroll] = useState({ top: 0, height: 0, view: 0 });
  const raf = useRef(0);
  const readScroll = () => {
    const el = screenRef.current;
    if (el) setScroll({ top: el.scrollTop, height: el.scrollHeight, view: el.clientHeight });
  };
  const onScroll = () => { cancelAnimationFrame(raf.current); raf.current = requestAnimationFrame(readScroll); };
  // …and once the image has settled or the frame has been resized, before any
  // scroll event has had a chance to fire.
  useEffect(() => { readScroll(); }, [cssHeight, screenH]);
  const imageH = cssHeight === null ? null : cssHeight * scale;
  const showMap = minimap && !liveSrc && sized && worthMapping(imageH, screenH);
  const screenId = useId();

  // The ruler IS the scrollbar: the screen's native one is hidden while the
  // ruler is up, so there is one thing to scroll with, and it is the one
  // that also knows where the findings are. Press anywhere on the track and
  // the thumb comes to the pointer; press on the thumb and it follows the
  // pointer from where it was grabbed; the arrow keys, PageUp/Down, Home and
  // End do what they do on any scrollbar.
  const drag = useRef<{ offset: number } | null>(null);
  const thumbTo = (y: number, trackH: number, smooth: boolean) => {
    const el = screenRef.current;
    if (!el || !drag.current) return;
    const band = bandFor(el.scrollTop, el.scrollHeight, el.clientHeight, trackH);
    const top = scrollForThumb(y - drag.current.offset, band.height, trackH, el.scrollHeight, el.clientHeight);
    if (smooth) el.scrollTo({ top, behavior: ms(200) === 0 ? "auto" : "smooth" });
    else el.scrollTop = top;
  };
  const onRulerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest("button")) return;
    const el = screenRef.current;
    if (!el) return;
    const r = e.currentTarget.getBoundingClientRect();
    const y = e.clientY - r.top;
    const band = bandFor(el.scrollTop, el.scrollHeight, el.clientHeight, r.height);
    const onThumb = y >= band.top && y <= band.top + band.height;
    drag.current = { offset: onThumb ? y - band.top : band.height / 2 };
    e.currentTarget.setPointerCapture(e.pointerId);
    thumbTo(y, r.height, !onThumb);
  };
  const onRulerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    const r = e.currentTarget.getBoundingClientRect();
    thumbTo(e.clientY - r.top, r.height, false);
  };
  const onRulerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    drag.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  };
  const onRulerKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const el = screenRef.current;
    if (!el) return;
    const max = Math.max(0, el.scrollHeight - el.clientHeight);
    const page = el.clientHeight * 0.9;
    const step: Record<string, number | null> = {
      ArrowDown: 40, ArrowUp: -40, PageDown: page, PageUp: -page, Home: -max, End: max,
    };
    const by = step[e.key];
    if (by === null || by === undefined) return;
    e.preventDefault();
    el.scrollTo({ top: Math.min(max, Math.max(0, el.scrollTop + by)), behavior: ms(200) === 0 ? "auto" : "smooth" });
  };

  // Nothing on screen yet and nothing has given up: still fetching. Once any
  // layer has painted, a swap crossfades over it rather than blanking it.
  const top = layers[layers.length - 1];
  const waiting = layers.length > 0 && !layers.some((l) => l.loaded && !l.dead) && !top?.dead;
  const dead = Boolean(top?.dead) && !layers.some((l) => l.loaded && !l.dead);

  // A box is drawable only where the image exists: the fold image cannot show
  // a finding 3000px down the page. The rail says "below the fold" for those.
  const drawable = highlight && cssHeight !== null && highlight.y < cssHeight && scale > 0 ? highlight : null;

  return (
    <div ref={host} className={cn("w-full", zoom === "actual" && "overflow-x-auto")}>
     <div className="mx-auto flex w-fit items-start" style={{ gap: MAP_GAP }}>
      <div
        ref={frameRef}
        className={cn("relative shadow-md", shape === "desktop" ? "rounded-xl" : "", frameClassName)}
        style={{
          width: screenW + 2 * skin.bezelX,
          height: screenH + skin.bezelTop + skin.bezelBottom + chrome,
          borderRadius: skin.radius,
          padding: `${skin.bezelTop}px ${skin.bezelX}px ${skin.bezelBottom}px`,
          background: BODY,
          visibility: sized ? "visible" : "hidden",
        }}
        aria-label={title}
      >
        {/* The body. Decorative: it says which handset this is, and a screen
            reader is told that by the caption under the frame. */}
        {skin.buttons.map((b, i) => (
          <span
            key={i}
            aria-hidden
            style={{
              position: "absolute", width: 3,
              [b.side]: -2, top: `${b.top * 100}%`, height: `${b.height * 100}%`,
              background: HARDWARE,
              borderRadius: b.side === "left" ? "2px 0 0 2px" : "0 2px 2px 0",
            }}
          />
        ))}
        {cut && (
          <span
            aria-hidden
            style={{
              position: "absolute", left: skin.cutout === "hole-left" ? "28%" : "50%",
              transform: "translateX(-50%)",
              top: Math.max(2, Math.round((skin.bezelTop - cut.height) / 2)),
              width: cut.width, height: cut.height,
              background: skin.cutout === "earpiece" ? HARDWARE : "#05070a",
              borderRadius: 999,
            }}
          />
        )}
        {skin.home && (
          <span
            aria-hidden
            style={{
              position: "absolute", left: "50%", transform: "translateX(-50%)",
              bottom: Math.max(6, Math.round((skin.bezelBottom - 30) / 2)),
              width: 30, height: 30, borderRadius: 999,
              border: `2px solid ${HARDWARE}`,
            }}
          />
        )}
        {shape === "desktop" && (
          <div className="flex items-center gap-2 px-3 text-[11px] text-white/70" style={{ height: CHROME_H }}>
            <span className="flex gap-1.5" aria-hidden><i className="size-2.5 rounded-full bg-[#ff5f57]" /><i className="size-2.5 rounded-full bg-[#febc2e]" /><i className="size-2.5 rounded-full bg-[#28c840]" /></span>
            <span className="ml-2 flex-1 truncate rounded-md bg-white/10 px-2.5 py-1 text-left">{title ?? ""}</span>
          </div>
        )}
        <div
          ref={screenRef}
          aria-label={alt}
          id={screenId}
          className={cn("relative bg-white",
            // A live page scrolls inside itself, the way it would on the
            // device; a capture is one tall image the frame scrolls instead.
            liveSrc ? "overflow-hidden" : "overflow-y-auto overflow-x-hidden",
            // One scrollbar, not two: while the ruler is up it is the scrollbar.
            showMap && "[scrollbar-width:none] [&::-webkit-scrollbar]:hidden")}
          style={{ width: screenW, height: screenH, borderRadius: skin.screenRadius }}
          onScroll={liveSrc ? undefined : onScroll}
        >
          {liveSrc ? (
            // Laid out at the profile's real width and then scaled, so the
            // page answers the viewport it would actually get. Scaling the
            // box instead would hand it a narrower width and a different
            // breakpoint. No allow-top-navigation: a page that busts frames
            // must not be able to navigate the Dashboard away.
            <iframe
              key={liveSrc}
              src={liveSrc}
              title={alt}
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
              className="block border-0 bg-white"
              style={{ width: viewport.width, height: viewport.height,
                       transform: `scale(${scale})`, transformOrigin: "top left" }}
            />
          ) : null}
          {!liveSrc && layers.length === 0 && (
            <div className="grid h-full place-items-center px-4 text-center text-[12px] text-text-secondary">No screenshot for this device</div>
          )}

          {/* Fetching the capture takes a few seconds — the full page is
              refused before the fold is fetched — and a large frame with
              nothing in it reads as a broken page. Say which it is. */}
          {!liveSrc && waiting && (
            <div role="status" className="absolute inset-0 grid place-items-center gap-2 bg-white px-4 text-center">
              <span className="flex flex-col items-center gap-2">
                <Loader2 className="size-5 animate-spin text-text-secondary" aria-hidden />
                <span className="text-[12px] text-text-secondary">Loading the screenshot…</span>
              </span>
            </div>
          )}
          {!liveSrc && dead && (
            <div className="absolute inset-0 grid place-items-center bg-white px-6 text-center">
              <span className="flex flex-col items-center gap-2">
                <ImageOff className="size-6 text-text-secondary" aria-hidden />
                <span className="text-[13px] font-medium text-text-primary">This screenshot is no longer stored</span>
                <span className="text-[12px] leading-snug text-text-secondary">
                  Neither the stored fold nor the full page could be loaded. Run the check again to capture it.
                </span>
              </span>
            </div>
          )}

          {!liveSrc && layers.filter((l) => !l.dead).map((l, i, shownLayers) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={l.key}
              ref={(el) => { if (el) imgs.current.set(l.key, el); else imgs.current.delete(l.key); }}
              src={l.src}
              alt={alt}
              draggable={false}
              onLoad={(e) => settle(l.key, e.currentTarget)}
              onError={() => fail(l.key)}
              className={cn("block w-full select-none", i < shownLayers.length - 1 ? "absolute inset-x-0 top-0" : "relative")}
              style={{ opacity: l.loaded ? 1 : 0, transition: `opacity ${ms(FADE_MS)}ms ease` }}
            />
          ))}
          {!liveSrc && drawable && (
            <Highlight key={`${drawable.x},${drawable.y},${drawable.width},${drawable.height}`} box={drawable} scale={scale} container={screenRef} screenH={screenH} />
          )}
          {/* The pins. Numbered in the list's order, so #1 is the worst thing
              on the page, and clickable: the screenshot is the index. */}
          {!liveSrc && cssHeight !== null && scale > 0 && placePins(pins, scale, screenW).map((pin) => {
            const on = pin.id === selectedPin;
            return (
              <button
                key={pin.id}
                type="button"
                aria-label={`Finding ${pin.n}: ${pin.label}`}
                aria-pressed={on}
                onClick={() => onPinSelect?.(pin.id)}
                className={cn(
                  "absolute z-10 grid size-[22px] -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full text-[11px] font-bold tabular-nums text-white shadow-[0_2px_6px_rgba(0,0,0,0.45)] ring-2 ring-white transition-transform duration-200 hover:scale-125 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
                  PIN_TONE[pin.severity],
                  on && "z-20 scale-125 ring-accent",
                )}
                style={{
                  left: Math.max(11, Math.min(screenW - 11, pin.left)),
                  top: Math.max(11, pin.top),
                }}
              >
                {pin.n}
              </button>
            );
          })}
          {children}
        </div>
      </div>

      {/* The overview ruler: a scrollbar that also knows where the findings
          are. A thin track the height of the screen, the window's thumb on
          it, and a mark per finding in its severity's colour — the same
          device as a code editor's scroll gutter, which everyone already
          reads without being told. It says "where am I" and "where are the
          problems" without drawing anything of the page itself. A click on
          the track jumps there; a click on a mark selects that finding. */}
      {showMap && cssHeight !== null && (() => {
        const pageH = scroll.height || imageH || 0, viewH = scroll.view || screenH;
        const band = bandFor(scroll.top, pageH, viewH, screenH);
        const range = Math.max(1, pageH - viewH);
        return (
        <div
          role="scrollbar"
          aria-label="Page position"
          aria-controls={screenId}
          aria-orientation="vertical"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(Math.min(1, scroll.top / range) * 100)}
          tabIndex={0}
          className="group relative shrink-0 touch-none select-none rounded-full bg-white/10 ring-1 ring-white/15 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-purple"
          style={{ width: MAP_W, height: screenH, marginTop: skin.bezelTop + chrome }}
          onPointerDown={onRulerDown}
          onPointerMove={onRulerMove}
          onPointerUp={onRulerUp}
          onPointerCancel={onRulerUp}
          onKeyDown={onRulerKey}
        >
          <div aria-hidden
               className="pointer-events-none absolute inset-x-0 cursor-grab rounded-full bg-white/45 transition-colors group-hover:bg-white/65 group-active:bg-white/80"
               style={{ top: band.top, height: band.height }} />
          {clusterDots(pins, viewport.width, cssHeight, MAP_W, screenH).map((d) => {
            const on = selectedPin !== null && d.ids.includes(selectedPin);
            const label = d.ns.length === 1 ? `Finding ${d.ns[0]}` : `Findings ${d.ns.join(", ")}`;
            return (
              <button
                key={d.ids[0]}
                type="button"
                aria-label={label}
                title={label}
                aria-pressed={on}
                onClick={(e) => { e.stopPropagation(); onPinSelect?.(d.ids[0]); }}
                className={cn("absolute inset-x-0 h-[3px] -translate-y-1/2 rounded-sm transition-transform hover:scale-y-[1.8] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent",
                              PIN_TONE[d.severity], on && "z-10 scale-y-[1.8] ring-2 ring-accent")}
                style={{ top: d.top }}
              />
            );
          })}
        </div>
        );
      })()}
     </div>
    </div>
  );
}

// The highlight: mounts transparent, fades in over 200ms, and scrolls the
// screen so the box sits in the upper third. Keyed on the box, so a new
// selection is a new fade rather than a jump.
function Highlight({ box, scale, container, screenH }: {
  box: Box; scale: number; container: React.RefObject<HTMLDivElement | null>; screenH: number;
}) {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setOn(true));
    const el = container.current;
    if (el) {
      const top = box.y * scale;
      const want = Math.max(0, Math.round(top - screenH / 3));
      if (Math.abs(el.scrollTop - want) > 4) el.scrollTo({ top: want, behavior: ms(200) === 0 ? "auto" : "smooth" });
    }
    return () => cancelAnimationFrame(id);
  }, [box, scale, container, screenH]);
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute rounded-[3px] border-2 border-accent bg-accent/15 shadow-[0_0_0_2px_rgba(255,255,255,.85)]"
      style={{
        left: Math.max(0, box.x * scale - 2), top: Math.max(0, box.y * scale - 2),
        width: Math.max(8, box.width * scale + 4), height: Math.max(8, box.height * scale + 4),
        opacity: on ? 1 : 0, transition: `opacity ${ms(200)}ms ease`,
      }}
    />
  );
}
