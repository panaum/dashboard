"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import {
  ChevronLeft, ChevronRight, Download, ExternalLink, Image as ImageIcon,
  Maximize2, Minimize2, X,
} from "lucide-react";
import { cn } from "@/lib/utils";

// THE ATTACHMENT VIEWER, laid out like the reference: the image fills the
// space, and everything about it sits underneath — name, then when it was
// added and how big it is, then one row of actions.
//
// Two details that are load-bearing rather than decorative:
//
//  · At actual size the container must NOT centre with flex. A child wider
//    than a centred flex container overflows to negative coordinates and the
//    top-left of the image becomes unreachable, scrollbars or not. Fit mode
//    centres; actual mode scrolls.
//  · Escape is handled in the CAPTURE phase and stops there. Without that,
//    one press closes the viewer AND the card underneath it.

const subscribeNever = () => () => {};

export type LightboxImage = {
  id: string;
  filename: string | null;
  bytes: number;
  createdAt: string;
  isCover: boolean;
};

/** "1.36 MB" — the unit the reference uses, and the one people recognise. */
function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

function formatAdded(iso: string, tz?: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("en-GB", {
    day: "numeric", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: false,
    ...(tz ? { timeZone: tz } : {}),
  });
}

export function ImageLightbox({
  images,
  startId,
  src,
  tz,
  onClose,
  onCover,
  onDelete,
}: {
  images: LightboxImage[];
  startId: string;
  /** Same URL builder the card uses — the developer's carries the board token. */
  src: (id: string) => string;
  tz?: string;
  onClose: () => void;
  /** Passing null clears the cover. Omitted where the viewer may not change it. */
  onCover?: (imageId: string | null) => void;
  onDelete?: (imageId: string) => void;
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

  const name = current.filename ?? "Image";
  const action =
    "flex items-center gap-2 rounded-md px-3 py-2 text-[13px] text-white/80 transition-colors hover:bg-white/10 hover:text-white";

  const overlay = (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={name}
      className="fixed inset-0 z-[70] flex flex-col bg-black/85"
      onClick={onClose}
    >
      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        className="absolute right-4 top-4 z-10 rounded-full bg-white/10 p-2 text-white transition-colors hover:bg-white/20"
      >
        <X className="size-4" />
      </button>

      {/* The image. Fit mode centres; actual mode scrolls — see the note above. */}
      <div
        className={cn(
          "min-h-0 flex-1 px-4 pt-14",
          actualSize ? "overflow-auto" : "flex items-center justify-center",
        )}
        onClick={(e) => e.stopPropagation()}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src(current.id)}
          alt={current.filename ?? ""}
          onClick={() => setActualSize((v) => !v)}
          className={cn(
            "rounded-lg",
            actualSize
              ? "mx-auto block max-w-none cursor-zoom-out"
              : "max-h-full max-w-full cursor-zoom-in object-contain",
          )}
        />
      </div>

      {/* Everything about the image, underneath it. */}
      <div
        className="flex shrink-0 flex-col items-center gap-1 px-4 pb-6 pt-5 text-center"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="max-w-full truncate text-[22px] font-semibold text-white">{name}</p>
        <p className="text-[13px] text-white/60">
          {/* The reference's own separator, down to the bullet. */}
          Added {formatAdded(current.createdAt, tz)} • {formatBytes(current.bytes)}
          {count > 1 && <span className="tabular-nums"> • {index + 1} of {count}</span>}
        </p>

        <div className="mt-3 flex flex-wrap items-center justify-center gap-1">
          <a href={src(current.id)} target="_blank" rel="noopener" className={action}>
            <ExternalLink className="size-4" /> Open in new tab
          </a>
          <a href={src(current.id)} download={current.filename ?? "image"} className={action}>
            <Download className="size-4" /> Download
          </a>
          <button
            type="button"
            onClick={() => setActualSize((v) => !v)}
            className={action}
          >
            {actualSize ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
            {actualSize ? "Fit to window" : "Actual size"}
          </button>
          {onCover && (
            <button
              type="button"
              onClick={() => onCover(current.isCover ? null : current.id)}
              className={action}
            >
              <ImageIcon className="size-4" />
              {current.isCover ? "Remove cover" : "Make cover"}
            </button>
          )}
          {onDelete && (
            <button
              type="button"
              onClick={() => { onDelete(current.id); onClose(); }}
              className={cn(action, "hover:bg-red-500/20 hover:text-red-200")}
            >
              <X className="size-4" /> Delete
            </button>
          )}
        </div>
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
