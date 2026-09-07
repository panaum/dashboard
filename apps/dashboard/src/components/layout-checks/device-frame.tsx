"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { Shape } from "@/lib/layout-checks/devices-view";

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

export function DeviceFrame({
  shape,
  viewport,
  scaleRef,
  src,
  fallbackSrc,
  alt,
  title,
  maxHeight = 640,
  children,
}: {
  shape: Shape;
  viewport: { width: number; height: number };
  /** Receives the CSS-px → screen-px scale so overlays can be placed. */
  scaleRef?: (scale: number) => void;
  src: string | null;
  fallbackSrc?: string | null;
  alt: string;
  title?: string;
  maxHeight?: number;
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
  const settle = (key: number) => {
    setLayers((ls) => ls.map((l) => (l.key === key ? { ...l, loaded: true } : l)));
    window.setTimeout(() => setLayers((ls) => (ls.length > 1 && ls[ls.length - 1].key === key ? ls.slice(-1) : ls)), FADE_MS + 30);
  };
  const fail = (key: number) => {
    setLayers((ls) => ls.map((l) => (l.key === key && !l.failed && fallbackSrc
      ? { ...l, src: fallbackSrc, failed: true } : l.key === key ? { ...l, loaded: true, failed: true } : l)));
  };

  return (
    <div ref={host} className="w-full">
      <div
        className={cn("mx-auto bg-[#15181e] shadow-md", shape === "desktop" ? "rounded-xl" : "")}
        style={{
          width: screenW + 2 * bezel.x,
          height: screenH + 2 * bezel.y + chrome,
          borderRadius: bezel.radius,
          padding: `${bezel.y}px ${bezel.x}px`,
          transition: `width 200ms ease, height 200ms ease, border-radius 200ms ease`,
          visibility: scale > 0 ? "visible" : "hidden",
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
          className="relative overflow-y-auto overflow-x-hidden bg-white"
          style={{ width: screenW, height: screenH, borderRadius: bezel.screen, transition: "width 200ms ease, height 200ms ease" }}
        >
          {layers.length === 0 && (
            <div className="grid h-full place-items-center px-4 text-center text-[12px] text-text-muted">No screenshot for this device</div>
          )}
          {layers.map((l, i) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={l.key}
              src={l.src}
              alt={alt}
              draggable={false}
              onLoad={() => settle(l.key)}
              onError={() => fail(l.key)}
              className={cn("block w-full select-none", i < layers.length - 1 ? "absolute inset-x-0 top-0" : "relative")}
              style={{ opacity: l.loaded ? 1 : 0, transition: `opacity ${FADE_MS}ms ease` }}
            />
          ))}
          {children}
        </div>
      </div>
    </div>
  );
}
