// Contrast, computed from the tokens rather than trusted.
//
// #95 put a "First screen only" caption on the dark stage in
// text-warning-strong — a token whose whole purpose is dark text on a light
// card. On the navy stage it measures 2.70:1, well under AA, and nobody
// noticed for weeks because a colour that looks deliberate reads as checked.
// Every polish pass moves colour around, so the arithmetic lives here and the
// test beside it fails the build instead.

/** #rgb, #rrggbb or #rrggbbaa -> [r, g, b] 0-255, alpha dropped (composite first). */
export function parseHex(hex: string): [number, number, number] {
  let h = hex.trim().replace(/^#/, "");
  if (h.length === 3 || h.length === 4) h = h.slice(0, 3).split("").map((c) => c + c).join("");
  if (h.length === 8) h = h.slice(0, 6);
  if (!/^[0-9a-fA-F]{6}$/.test(h)) throw new Error(`not a hex colour: ${hex}`);
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
}

/** WCAG 2.1 relative luminance. */
export function luminance(hex: string): number {
  const [r, g, b] = parseHex(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2.1 contrast ratio, 1–21. */
export function contrastRatio(a: string, b: string): number {
  const la = luminance(a), lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** `fg` at `alpha` painted over `bg`. Tailwind's `/NN` utilities are alpha,
 *  and alpha over a dark ground is a different colour than the token. */
export function composite(fg: string, alpha: number, bg: string): string {
  const f = parseHex(fg), b = parseHex(bg);
  const out = f.map((v, i) => Math.round(v * alpha + b[i] * (1 - alpha)));
  return "#" + out.map((v) => v.toString(16).padStart(2, "0")).join("");
}

/** The `--color-*` custom properties out of a Tailwind v4 `@theme` block. */
export function parseThemeTokens(css: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of css.matchAll(/--color-([a-z0-9-]+)\s*:\s*(#[0-9a-fA-F]{3,8})\s*;/g)) {
    out[m[1]] = m[2];
  }
  return out;
}

/** A Tailwind colour spec as written in a class: `text-secondary`,
 *  `white/55`, `warning/15`. Resolved against the tokens, composited onto
 *  `over` when it carries an alpha. */
export function resolveColor(spec: string, tokens: Record<string, string>, over: string): string {
  const [name, pct] = spec.split("/");
  const base = name === "white" ? "#ffffff"
             : name === "black" ? "#000000"
             : tokens[name];
  if (!base) throw new Error(`no token for "${name}" (spec "${spec}")`);
  if (pct === undefined) return base;
  const alpha = Number(pct) / 100;
  if (!Number.isFinite(alpha) || alpha < 0 || alpha > 1) throw new Error(`bad alpha in "${spec}"`);
  return composite(base, alpha, over);
}

/** AA minimums. Large text is >=24px, or >=18.66px bold. */
export const AA_NORMAL = 4.5;
export const AA_LARGE = 3;
