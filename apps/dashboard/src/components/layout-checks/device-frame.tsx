"use client";

import React, { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { Shape } from "@/lib/layout-checks/devices-view";
import { ms } from "@/lib/layout-checks/motion";

// A generic frame per platform — a bezelled rounded rectangle for phones, a
// wider one for tablets, a browser chrome bar for desktop — sized to the
// selected viewport's aspect ratio and scaled to fit. Not handset-accurate:
// a notch tells the reader nothing. The frame's width and height transition
// (~200ms) when the selection changes shape, and only the image inside
// crossfades (150ms); the frame stays put.

const BEZEL: Record<Shape, { x: number; y: number; radius: number; screen: number }> = {
  phone: { x: 12, y: 36, radius: 40, screen: 26 },
  tablet: { x: 16, y: 22, radius: 26, screen: 12 },
  desktop: { x: 0, y: 0, radius: 12, screen: 0 },
};
const CHROME_H = 34;          // the desktop title bar
const FADE_MS = 150;

type Layer = { key: number; src: string; loaded: boolean; failed: boolean };
export type Box = { x: number; y: number; width: number; height: number };

export function DeviceFrame({
  shape,
  viewport,
  scaleRef,
  src,
  fallbackSrc,
  liveSrc = null,
  alt,
  title,
  maxHeight = 640,
  highlight = null,
  onImageMeta,
  children,
}: {
  shape: Shape;
  viewport: { width: number; height: number };
  /** Receives the CSS-px → screen-px scale so overlays can be placed. */
  scaleRef?: (scale: number) => void;
  src: string | null;
  fallbackSrc?: string | null;
  /** The real page, loaded in the frame instead of a capture of it. */
  liveSrc?: string | null;
  alt: string;
  title?: string;
  maxHeight?: number;
  /** A finding's box in CSS px of the page; drawn over the image and scrolled into view. */
  highlight?: Box | null;
  /** Reports the loaded image's height in CSS px (null while nothing is loaded). */
  onImageMeta?: (meta: { cssHeight: number } | null) => void;
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

  const bezel = BEZEL[shape];
  const chrome = shape === "desktop" ? CHROME_H : 0;
  const maxW = Math.max(0, avail - 2 * bezel.x);
  const maxH = Math.max(0, maxHeight - 2 * bezel.y - chrome);
  const scale = avail > 0 ? Math.min(maxW / viewport.width, maxH / viewport.height) : 0;
  const screenW = Math.round(viewport.width * scale);
  const screenH = Math.round(viewport.height * scale);
  useEffect(() => { scaleRef?.(scale); }, [scale, scaleRef]);
  const sized = scale > 0;

  // Crossfade: the new image mounts on top at opacity 0 and fades in once it
  // has loaded; the previous one is dropped after the fade. A source that
  // fails (the service pruned the run) is replaced by the stored fold.
  const [layers, setLayers] = useState<Layer[]>(() => src ? [{ key: 0, src, loaded: false, failed: false }] : []);
  const keyRef = useRef(0);
  useEffect(() => {
    setLayers((ls) => {
      const top = ls[ls.length - 1];
      if (top && top.src === src) return ls;
      if (!src) return [];
      keyRef.current += 1;
      return [...ls.slice(-1), { key: keyRef.current, src, loaded: false, failed: false }];
    });
  }, [src]);
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
  const fail = (key: number) => {
    setLayers((ls) => ls.map((l) => (l.key === key && !l.failed && fallbackSrc
      ? { ...l, src: fallbackSrc, failed: true } : l.key === key ? { ...l, loaded: true, failed: true } : l)));
  };

  // A box is drawable only where the image exists: the fold image cannot show
  // a finding 3000px down the page. The rail says "below the fold" for those.
  const drawable = highlight && cssHeight !== null && highlight.y < cssHeight && scale > 0 ? highlight : null;

  return (
    <div ref={host} className="w-full">
      <div
        ref={frameRef}
        className={cn("mx-auto bg-[#15181e] shadow-md", shape === "desktop" ? "rounded-xl" : "")}
        style={{
          width: screenW + 2 * bezel.x,
          height: screenH + 2 * bezel.y + chrome,
          borderRadius: bezel.radius,
          padding: `${bezel.y}px ${bezel.x}px`,
          visibility: sized ? "visible" : "hidden",
        }}
        aria-label={title}
      >
        {shape === "desktop" && (
          <div className="flex items-center gap-2 px-3 text-[11px] text-white/70" style={{ height: CHROME_H }}>
            <span className="flex gap-1.5" aria-hidden><i className="size-2.5 rounded-full bg-[#ff5f57]" /><i className="size-2.5 rounded-full bg-[#febc2e]" /><i className="size-2.5 rounded-full bg-[#28c840]" /></span>
            <span className="ml-2 flex-1 truncate rounded-md bg-white/10 px-2.5 py-1 text-left">{title ?? ""}</span>
          </div>
        )}
        <div
          ref={screenRef}
          aria-label={alt}
          className={cn("relative bg-white",
            // A live page scrolls inside itself, the way it would on the
            // device; a capture is one tall image the frame scrolls instead.
            liveSrc ? "overflow-hidden" : "overflow-y-auto overflow-x-hidden")}
          style={{ width: screenW, height: screenH, borderRadius: bezel.screen }}
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
            <div className="grid h-full place-items-center px-4 text-center text-[12px] text-text-muted">No screenshot for this device</div>
          )}
          {!liveSrc && layers.map((l, i) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={l.key}
              src={l.src}
              alt={alt}
              draggable={false}
              onLoad={(e) => settle(l.key, e.currentTarget)}
              onError={() => fail(l.key)}
              className={cn("block w-full select-none", i < layers.length - 1 ? "absolute inset-x-0 top-0" : "relative")}
              style={{ opacity: l.loaded ? 1 : 0, transition: `opacity ${ms(FADE_MS)}ms ease` }}
            />
          ))}
          {!liveSrc && drawable && (
            <Highlight key={`${drawable.x},${drawable.y},${drawable.width},${drawable.height}`} box={drawable} scale={scale} container={screenRef} screenH={screenH} />
          )}
          {children}
        </div>
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
