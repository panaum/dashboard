// THE ELEMENT'S OWN NUMBERS, AS ONE LINE.
//
// A finding says what the tool measured — "77 × 14px, under the 24px minimum".
// The element's computed style says what the stylesheet did to produce that:
// font-size 11px, padding 0, min-height 15px. The first is the symptom, the
// second is what the fix changes. devicepreview records the handful that a
// layout fix turns (see `numbers()` in its audit); this puts them in the order
// a developer reads them, and leaves out what says nothing.
//
// Pure, so the wording is tested without a run.

export type ElementStyle = Partial<Record<
  "fontSize" | "lineHeight" | "fontWeight" | "padding" | "minHeight" | "minWidth" | "width" | "height" | "display" | "position" | "overflow",
  string
>>;

const ORDER: [keyof ElementStyle, string][] = [
  ["fontSize", "font-size"], ["lineHeight", "line-height"], ["fontWeight", "weight"],
  ["padding", "padding"], ["minHeight", "min-height"], ["minWidth", "min-width"],
  ["display", "display"], ["position", "position"], ["overflow", "overflow"],
];

/** "font-size 11px · padding 0px · min-height 15px · 20×20px · inline-block", or null. */
export function numbersLine(style: ElementStyle | null | undefined): string | null {
  if (!style) return null;
  const parts: string[] = [];
  for (const [key, word] of ORDER) {
    const v = style[key];
    if (!v) continue;
    // A weight of 400 is the default and says nothing; any other weight does.
    if (key === "fontWeight" && (v === "400" || v === "normal")) continue;
    parts.push(key === "display" || key === "position" || key === "overflow" ? v : `${word} ${v}`);
  }
  if (style.width && style.height) parts.push(`${style.width.replace("px", "")}×${style.height}`);
  return parts.length ? parts.join(" · ") : null;
}
