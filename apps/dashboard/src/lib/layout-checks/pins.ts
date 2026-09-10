// PINS — the numbers that tie the findings list to the screenshot.
//
// A finding that was measured somewhere on the page carries a box. Drawn on
// the capture as a numbered marker, and carrying the same number in the list,
// the screenshot stops being a picture and becomes the index: you see WHERE
// the problems are before reading a word, and the list says what each one is.
//
// Numbering follows the list's own order (worst first), so #1 is the worst
// thing on the page. A finding whose box lies below the stored image cannot
// be drawn — those keep their place in the list and get no number, rather
// than being given one that points at nothing.

export type PinBox = { x: number; y: number; width: number; height: number };

export type PinSource = {
  id: string;
  severity: "error" | "warn" | "info";
  box: PinBox | null;
  /** Page-level findings (viewport meta, layout shift) have nowhere to point. */
  pageLevel?: boolean;
};

export type Pin = {
  id: string;
  n: number;
  severity: "error" | "warn" | "info";
  box: PinBox;
};

/** Is this finding's box inside the image we actually have? */
export function drawable(item: PinSource, imageHeight: number | null): boolean {
  if (!item.box || item.pageLevel) return false;
  if (item.box.width <= 0 || item.box.height <= 0) return false;
  return imageHeight === null || item.box.y < imageHeight;
}

/** The pins for one screenshot, numbered in list order. */
export function pinsFor(items: PinSource[], imageHeight: number | null): Pin[] {
  const out: Pin[] = [];
  for (const it of items) {
    if (!drawable(it, imageHeight)) continue;
    out.push({ id: it.id, n: out.length + 1, severity: it.severity, box: it.box as PinBox });
  }
  return out;
}

/** The number shown beside a finding in the list, or null when it has none. */
export function pinNumber(pins: Pin[], id: string): number | null {
  return pins.find((p) => p.id === id)?.n ?? null;
}

export type Placed = { left: number; top: number };
export type PlacedPin = Pin & Placed;

/** How close two pins may sit before they count as the same spot, and how far
 *  apart to fan them, both in screen pixels. A pin is 22px across. */
const GAP = 20;
const STEP = 22;

/** Where each pin actually goes on the capture, in screen pixels.
 *
 *  Several findings routinely share one element — a call-to-action can be too
 *  small, too close to its neighbour AND carry text under 12px — and their
 *  boxes are then identical. Drawn honestly at the measured point they land on
 *  top of one another: you see the last one, and only the last one can be
 *  clicked. So a pin that lands on an occupied spot steps to the right until
 *  it is clear, which reads as what it is: three things about this element. */
export function placePins<T extends Pin>(pins: T[], scale: number): (T & Placed)[] {
  const placed: (T & Placed)[] = [];
  for (const pin of pins) {
    const top = pin.box.y * scale;
    let left = pin.box.x * scale;
    // Bounded: a spot with a dozen findings stops fanning rather than marching
    // off the screen, and the last few sit together.
    for (let guard = 0; guard < 12; guard += 1) {
      const clash = placed.some((q) => Math.abs(q.left - left) < GAP && Math.abs(q.top - top) < GAP);
      if (!clash) break;
      left += STEP;
    }
    placed.push({ ...pin, left, top });
  }
  return placed;
}
