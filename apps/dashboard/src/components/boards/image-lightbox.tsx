"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, ExternalLink, Maximize2, Minimize2, X } from "lucide-react";
import { cn } from "@/lib/utils";

// A screenshot on a card is the evidence, so it has to be readable. This opens
// it over the card at full size, and lets you switch to 1:1 when "fit to the
// window" is still too small to read a label in the corner of a 2940px grab.
//
// It portals to <body> like Dialog does, and its Escape handler runs in the
// capture phase and stops there: without that, one Escape would close the
// lightbox AND the card underneath it.

const subscribeNever = () => () => {};

export type LightboxImage = { id: string; filename: string | null };

export function ImageLightbox({
  images,
  startId,
  src,
  onClose,
}: {
  images: LightboxImage[];
  startId: string;
  /** Same URL builder the card uses — the developer's carries the board token. */
  src: (id: string) => string;
  onClose: () => void;
}) {
  const startIndex = Math.max(0, images.findIndex((i) => i.id === startId));
  const [index, setIndex] = React.useState(startIndex);
  const [actualSize, setActualSize] = React.useState(false);
  const mounted = React.useSyncExternalStore(subscribeNever, () => true, () => false);

  const count = images.length;
  const current = images[index] ?? images[0];

  const go = React.useCallback((delta: number) => {
    setActualSize(false);
    setIndex((i) => (i + delta + count) % count);
  }, [count]);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.stopPropagation(); onClose(); return; }
      if (count < 2) return;
      if (e.key === "ArrowRight") { e.stopPropagation(); go(1); }
      if (e.key === "ArrowLeft") { e.stopPropagation(); go(-1); }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose, go, count]);

  if (!current) return null;

  const overlay = (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={current.filename ?? "Image"}
      className="fixed inset-0 z-[70] flex flex-col bg-black/85"
      onClick={onClose}
    >
      <div className="flex items-center justify-between gap-3 px-4 py-3 text-white/85" onClick={(e) => e.stopPropagation()}>
        <span className="min-w-0 truncate text-[13px]">
          {current.filename ?? "Image"}
          {count > 1 && <span className="ml-2 tabular-nums text-white/55">{index + 1} / {count}</span>}
        </span>
        <span className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={() => setActualSize((v) => !v)}
            aria-label={actualSize ? "Fit to window" : "Actual size"}
            title={actualSize ? "Fit to window" : "Actual size"}
            className="rounded-full p-2 hover:bg-white/15"
          >
            {actualSize ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
          </button>
          <a
            href={src(current.id)}
            target="_blank"
            rel="noopener"
            aria-label="Open in a new tab"
            title="Open in a new tab"
            className="rounded-full p-2 hover:bg-white/15"
          >
            <ExternalLink className="size-4" />
          </a>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-full p-2 hover:bg-white/15">
            <X className="size-4" />
          </button>
        </span>
      </div>

      {/* At actual size the container must NOT centre with flex: a child wider
          than a centred flex container overflows to negative coordinates and
          the top-left of the image becomes unreachable, scrollbars or not. So
          fit mode centres, actual mode scrolls. The arrows sit outside both,
          pinned to the overlay, so neither layout has to make room for them. */}
      <div
        className={cn(
          "flex-1 px-4 pb-6",
          actualSize ? "overflow-auto" : "flex items-center justify-center",
        )}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src(current.id)}
          alt={current.filename ?? ""}
          onClick={(e) => { e.stopPropagation(); setActualSize((v) => !v); }}
          className={cn(
            "rounded-lg",
            actualSize
              ? "mx-auto block max-w-none cursor-zoom-out"
              : "max-h-full max-w-full cursor-zoom-in object-contain",
          )}
        />
      </div>

      {count > 1 && (
        <>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); go(-1); }}
            aria-label="Previous image"
            className="absolute left-3 top-1/2 z-10 -translate-y-1/2 rounded-full bg-white/10 p-2 text-white hover:bg-white/20"
          >
            <ChevronLeft className="size-5" />
          </button>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); go(1); }}
            aria-label="Next image"
            className="absolute right-3 top-1/2 z-10 -translate-y-1/2 rounded-full bg-white/10 p-2 text-white hover:bg-white/20"
          >
            <ChevronRight className="size-5" />
          </button>
        </>
      )}
    </div>
  );

  return mounted ? createPortal(overlay, document.body) : null;
}
