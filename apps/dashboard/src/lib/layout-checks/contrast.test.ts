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
const SURFACES: { name: string; bg: string; fg: string[]; graphical?: string[] }[] = [
  { name: "card", bg: T.card,
    fg: ["text-primary", "text-secondary", "accent", "error-strong", "success-strong"],
    graphical: ["text-muted"] },
  { name: "the accent pill", bg: T.accent, fg: ["white"] },
  { name: "page", bg: T.page, fg: ["text-primary", "text-secondary", "accent"], graphical: ["text-muted"] },
  { name: "card-soft", bg: T["card-soft"], fg: ["text-primary", "text-secondary", "accent"], graphical: ["text-muted"] },
  { name: "error tint on card", bg: composite(T.error, 0.12, T.card), fg: ["error-strong"] },
  { name: "warning tint on card", bg: composite(T.warning, 0.15, T.card), fg: ["warning-strong"] },
  { name: "success tint on card", bg: composite(T.success, 0.10, T.card), fg: ["success-strong"] },
  { name: "the dark stage", bg: T["brand-primary"],
    fg: ["white", "white/90", "white/70", "white/60", "white/55", "warning"],
    graphical: ["brand-purple"] },
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

// Measured, below AA, and deliberately not fixed here: the pin badges are the
// most prominent thing on the stage and recolouring them is a design decision,
// not a contrast patch. Two fixes both work — white numerals on the darker
// `-strong` pills (6.54 / 6.33 / 5.32), or dark numerals on the bright pills
// as they are (4.76 / 8.42 / 6.28, but the info pin still fails at 4.05) — and
// which one is right depends on whether the pill colour or the numeral is
// carrying the signal. That belongs to the visual polish pass.
//
// The list is asserted EXACTLY: nothing joins it quietly, and fixing one makes
// the test fail until the entry is deleted.
const KNOWN_BELOW_AA: { name: string; fg: string; bg: string; measured: number }[] = [
  { name: "white numerals on the error pin", fg: "white", bg: T.error, measured: 3.59 },
  { name: "white numerals on the warning pin", fg: "white", bg: T.warning, measured: 2.03 },
  { name: "white numerals on the info pin", fg: "white", bg: T["text-muted"], measured: 4.21 },
];

test("the known-failing pairs are still exactly these, and still failing", () => {
  const still = KNOWN_BELOW_AA.filter((k) => contrastRatio(resolveColor(k.fg, T, k.bg), k.bg) < AA_NORMAL);
  assert.equal(still.length, KNOWN_BELOW_AA.length,
    "a known-failing pair now passes — delete its entry from KNOWN_BELOW_AA");
  for (const k of KNOWN_BELOW_AA) {
    const r = contrastRatio(resolveColor(k.fg, T, k.bg), k.bg);
    assert.ok(Math.abs(r - k.measured) < 0.05, `${k.name}: measured ${r.toFixed(2)}, recorded ${k.measured}`);
  }
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
