// Contrast maths, and the two facts a dashboard needs from it.
//
// This page's job is making a red state impossible to miss. That falls apart
// quietly: a token drifts a shade lighter, nobody re-measures, and the
// supporting text drops under the readability floor everywhere at once. So the
// numbers live here and a test walks every token against every surface.

export type Rgb = { r: number; g: number; b: number };

export function parseHex(hex: string): Rgb | null {
  const m = /^#([0-9a-f]{6})$/i.exec((hex ?? "").trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

/** WCAG relative luminance. */
export function luminance(c: Rgb): number {
  const f = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
}

/** WCAG contrast ratio, 1–21. Order of the arguments does not matter. */
export function contrastRatio(a: string, b: string): number {
  const ca = parseHex(a);
  const cb = parseHex(b);
  if (!ca || !cb) return NaN;
  const la = luminance(ca);
  const lb = luminance(cb);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** AA: 4.5 for body text, 3.0 for large text and non-text indicators. */
export const AA_TEXT = 4.5;
export const AA_NON_TEXT = 3.0;

/** Every `--color-*: #rrggbb` declaration, keyed without the prefix. */
export function parseTokens(css: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of css.matchAll(/--color-([a-z0-9-]+)\s*:\s*(#[0-9a-fA-F]{6})/g)) {
    out[m[1]] = m[2].toLowerCase();
  }
  return out;
}

/** Token names used as a text colour (`text-foo`) or a surface (`bg-foo`). */
export function usedAs(
  kind: "text" | "bg",
  source: string,
  tokens: Record<string, string>,
): Set<string> {
  const found = new Set<string>();
  for (const name of Object.keys(tokens)) {
    // Whole class only, and tolerate an opacity modifier (`bg-error/10`).
    const re = new RegExp(`(?:^|[^a-z0-9-])${kind}-${name}(?![a-z0-9-])`, "g");
    if (re.test(source)) found.add(name);
  }
  return found;
}
