import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { AA_LARGE, AA_NORMAL, composite, contrastRatio, luminance, parseHex,
         parseThemeTokens, resolveColor } from "./contrast";

const CSS = readFileSync("src/app/globals.css", "utf8");
const T = parseThemeTokens(CSS);
const COMPONENTS = "src/components/layout-checks";

test("the arithmetic matches the WCAG worked examples", () => {
  assert.equal(contrastRatio("#ffffff", "#000000").toFixed(0), "21");
  assert.equal(contrastRatio("#ffffff", "#ffffff").toFixed(0), "1");
  assert.ok(Math.abs(luminance("#ffffff") - 1) < 1e-9);
  assert.ok(Math.abs(luminance("#000000")) < 1e-9);
  assert.deepEqual(parseHex("#fff"), [255, 255, 255]);
  assert.deepEqual(parseHex("#1a1a2e"), [26, 26, 46]);
  // Half white over black is mid grey, and symmetric.
  assert.equal(composite("#ffffff", 0.5, "#000000"), "#808080");
  assert.equal(contrastRatio("#1a1a2e", "#f5a623").toFixed(2), contrastRatio("#f5a623", "#1a1a2e").toFixed(2));
});

// Every text colour this page uses, and the ground it is painted on. A class
// that is not here fails the completeness test below, so adding a colour means
// declaring where it sits and letting the arithmetic judge it.
//
// `graphical` marks icons and non-text marks, which AA holds to 3:1 rather
// than 4.5:1. It is not an escape hatch for small text.
// The handset body in device-frame.tsx. Not a theme token — it is the colour
// of the drawn hardware — but the desktop frame's chrome bar sets text on it.
const BODY = "#15181e";

const SURFACES: { name: string; bg: string; fg: string[]; graphical?: string[] }[] = [
  // The stage is a card again: a near-white surface under the device, with its
  // caption, its warning line and its buttons on it.
  { name: "card, and the stage", bg: T.card,
    fg: ["text-primary", "text-secondary", "accent", "error-strong", "success-strong", "warning-strong"],
    graphical: ["text-muted"] },
  { name: "the accent pill", bg: T.accent, fg: ["white"] },
  // The verdict, its counts and the findings rail sit straight on the page:
  // no card behind them, so their severity words are judged against it.
  { name: "page", bg: T.page,
    fg: ["text-primary", "text-secondary", "accent", "error-strong", "warning-strong", "success-strong"],
    graphical: ["text-muted"] },
  { name: "card-soft", bg: T["card-soft"], fg: ["text-primary", "text-secondary", "accent"], graphical: ["text-muted"] },
  { name: "error tint on card", bg: composite(T.error, 0.12, T.card), fg: ["error-strong"] },
  { name: "warning tint on card", bg: composite(T.warning, 0.15, T.card), fg: ["warning-strong"] },
  { name: "success tint on card", bg: composite(T.success, 0.10, T.card), fg: ["success-strong"] },
  // The pin badges: a white numeral on a darkened pill, on the capture and in
  // the rail. On the bright fills these were the page's only contrast
  // failures — 2.03:1 on amber, 3.59:1 on red, 4.21:1 on grey.
  { name: "the error pin", bg: T["error-strong"], fg: ["white"] },
  { name: "the warning pin", bg: T["warning-strong"], fg: ["white"] },
  { name: "the note pin", bg: T["text-secondary"], fg: ["white"] },
  // The scroll ruler beside the frame: a thumb on a track, and the pins'
  // severity dots on it, all non-text marks.
  { name: "the ruler track", bg: T["border-soft"], fg: [],
    graphical: ["text-secondary/80", "error-strong", "warning-strong", "text-secondary"] },
  // The desktop frame's chrome bar, and the address pill on it.
  { name: "the handset body", bg: BODY, fg: ["white/70"] },
  { name: "the address pill on the body", bg: composite("#ffffff", 0.10, BODY), fg: ["white/70"] },
];

test("every declared pair meets AA", () => {
  const failures: string[] = [];
  for (const s of SURFACES) {
    for (const [list, min] of [[s.fg ?? [], AA_NORMAL], [s.graphical ?? [], AA_LARGE]] as const) {
      for (const fg of list) {
        const r = contrastRatio(resolveColor(fg, T, s.bg), s.bg);
        if (r < min) failures.push(`${fg} on ${s.name}: ${r.toFixed(2)}:1 (needs ${min})`);
      }
    }
  }
  assert.deepEqual(failures, [], "contrast regressed:\n  " + failures.join("\n  "));
});

test("warning-strong on the dark stage is the regression this guards", () => {
  // #95 put it there and it went unnoticed for weeks. Keep the number on the
  // record so nobody reaches for a light-card token on the stage again.
  assert.ok(contrastRatio(T["warning-strong"], T["brand-primary"]) < AA_NORMAL);
  assert.ok(contrastRatio(T.warning, T["brand-primary"]) >= AA_NORMAL);
});

// Nothing on this page is below AA, and nothing is excused. The three pin
// badges that used to be listed here now sit on darkened pills and are checked
// in SURFACES like every other pair. If something ever has to be excused, it
// goes here with its measured ratio — and the test below makes that a
// deliberate edit rather than a quiet one.
const KNOWN_BELOW_AA: { name: string; fg: string; bg: string; measured: number }[] = [];

test("the page has no contrast exceptions", () => {
  assert.deepEqual(KNOWN_BELOW_AA, [],
    "a pair below AA was excused — fix it instead, or make the case in review");
});

test("no colour is used on this page without being declared above", () => {
  const declared = new Set([
    ...SURFACES.flatMap((s) => [...(s.fg ?? []), ...(s.graphical ?? [])]),
    ...KNOWN_BELOW_AA.map((k) => k.fg),
  ]);
  // A utility, not a substring: `fill-text-secondary` and `bg-text-muted` are
  // not text colours and must not be swept in.
  const RE = /(?:^|[\s"'`({])text-([a-z][a-z0-9-]*(?:\/\d+)?)(?=[\s"'`)}]|$)/g;
  const NOT_COLOUR = /^(center|left|right|start|end|justify|balance|pretty|wrap|nowrap|clip|ellipsis|sm|xs|base|lg|xl|[0-9]|\[)/;
  const undeclared = new Map<string, string[]>();
  for (const file of readdirSync(COMPONENTS).filter((f) => f.endsWith(".tsx"))) {
    const src = readFileSync(join(COMPONENTS, file), "utf8");
    for (const m of src.matchAll(RE)) {
      const spec = m[1];
      if (NOT_COLOUR.test(spec)) continue;
      if (declared.has(spec)) continue;
      if (!undeclared.has(spec)) undeclared.set(spec, []);
      undeclared.get(spec)!.push(file);
    }
  }
  assert.deepEqual([...undeclared.keys()], [],
    "undeclared text colours — add them to SURFACES with the ground they sit on:\n  "
    + [...undeclared].map(([c, f]) => `${c} (${[...new Set(f)].join(", ")})`).join("\n  "));
});
