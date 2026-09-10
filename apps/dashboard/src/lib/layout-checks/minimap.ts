// The page map beside the device: where you are on a long page, and where
// the findings are, at a glance. Pure geometry so it is tested rather than
// eyeballed — everything here is a proportion of the track's height.

export type Band = { top: number; height: number };

/** The viewport's band on a track of `trackHeight`, for a scroll position
 *  `scrollTop` in an image `imageHeight` tall viewed through a window
 *  `windowHeight` tall. Never thinner than 6px, never off the track. */
export function bandFor(scrollTop: number, imageHeight: number, windowHeight: number, trackHeight: number): Band {
  if (imageHeight <= 0 || trackHeight <= 0) return { top: 0, height: trackHeight };
  const height = Math.max(6, Math.round(Math.min(1, windowHeight / imageHeight) * trackHeight));
  const maxTop = Math.max(0, trackHeight - height);
  const top = Math.min(maxTop, Math.max(0, Math.round((scrollTop / imageHeight) * trackHeight)));
  return { top, height };
}

/** Where to scroll so the point at `fraction` of the page sits mid-window. */
export function scrollFor(fraction: number, imageHeight: number, windowHeight: number): number {
  const f = Math.min(1, Math.max(0, fraction));
  return Math.max(0, Math.min(Math.max(0, imageHeight - windowHeight), Math.round(f * imageHeight - windowHeight / 2)));
}

/** A pin's dot on the track, from its box in page CSS px. */
export function dotFor(box: { x: number; y: number; width: number; height: number },
                       pageWidth: number, pageHeight: number,
                       trackWidth: number, trackHeight: number): { left: number; top: number } {
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  return {
    left: Math.round(Math.min(1, Math.max(0, cx / pageWidth)) * trackWidth),
    top: Math.round(Math.min(1, Math.max(0, cy / pageHeight)) * trackHeight),
  };
}

/** A map earns its place only when there is more page than window. */
export function worthMapping(imageHeight: number | null, windowHeight: number): boolean {
  return imageHeight !== null && imageHeight > windowHeight * 1.15;
}

export type Dot = { left: number; top: number; ids: string[]; ns: number[]; severity: "error" | "warn" | "info" };

const RANK = { error: 0, warn: 1, info: 2 } as const;

/** Pins on the track, merged where they would land on the same spot. Several
 *  findings routinely share one element; on a 56px map they are one place,
 *  so they become one dot in the worst of their colours that names all of
 *  them — rather than three dots stacked where only the top one can be hit.
 *  `within` is how close two dots may be, in track px, before they merge. */
export function clusterDots<T extends { id: string; n: number; severity: "error" | "warn" | "info"; box: { x: number; y: number; width: number; height: number } }>(
  pins: T[], pageWidth: number, pageHeight: number, trackWidth: number, trackHeight: number, within = 5,
): Dot[] {
  const dots: Dot[] = [];
  for (const pin of pins) {
    const at = dotFor(pin.box, pageWidth, pageHeight, trackWidth, trackHeight);
    const near = dots.find((d) => Math.abs(d.left - at.left) <= within && Math.abs(d.top - at.top) <= within);
    if (near) {
      near.ids.push(pin.id); near.ns.push(pin.n);
      if (RANK[pin.severity] < RANK[near.severity]) near.severity = pin.severity;
    } else {
      dots.push({ ...at, ids: [pin.id], ns: [pin.n], severity: pin.severity });
    }
  }
  return dots;
}
