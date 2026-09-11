"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { cropFor, cropStyle, type Box } from "@/lib/layout-checks/crop";

// A picture of one element, for the report. The same window maths the rail
// uses, but here the page height is not known until the image has loaded —
// so the crop waits for it rather than guessing and cropping into blank.
//
// A fault below the stored first screen has no picture to show. It says so,
// in words, instead of showing an empty rectangle.

export function EvidenceCrop({
  src, box, pageWidth, width, height, className,
}: {
  src: string;
  box: Box;
  /** The device's viewport width: the image is this many CSS px wide. */
  pageWidth: number;
  width: number;
  height: number;
  className?: string;
}) {
  const [pageHeight, setPageHeight] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const img = new Image();
    let alive = true;
    img.onload = () => {
      if (!alive) return;
      setPageHeight(img.naturalWidth ? Math.round(img.naturalHeight * pageWidth / img.naturalWidth) : null);
    };
    img.onerror = () => { if (alive) setFailed(true); };
    img.src = src;
    return () => { alive = false; img.onload = null; img.onerror = null; };
  }, [src, pageWidth]);

  // The page's full width, so every entry in the report is the same view at
  // the same scale rather than each element zoomed to its own size.
  const crop = pageHeight === null ? null : cropFor(box, pageWidth, pageHeight, width, height, 24, 300, pageWidth);
  const shell = cn("block shrink-0 overflow-hidden rounded-xl bg-card-soft ring-1 ring-inset ring-border-soft", className);

  if (failed || (pageHeight !== null && !crop)) {
    return (
      <span className={shell} style={{ width, height }}>
        <span className="grid h-full place-items-center px-3 text-center text-[11px] leading-snug text-text-secondary">
          {failed ? "screenshot not kept for this run" : "below the first screen"}
        </span>
      </span>
    );
  }
  return (
    <span aria-hidden className={shell} style={{ width, height, ...(crop ? cropStyle(src, crop, pageWidth) : {}) }} />
  );
}
