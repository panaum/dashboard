import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import {
  AA_NON_TEXT, AA_TEXT, contrastRatio, parseHex, parseTokens, usedAs,
} from "./contrast";

// The guard. Not a checker somebody remembers to point at a page — every
// colour token that appears as text is measured against every surface this app
// paints, on every run.
//
// It ratchets rather than exempts. Known debt is listed once, with its issue;
// a NEW failure fails the build, and a listed failure that has been FIXED also
// fails the build, so the list cannot rot into a permanent excuse.

const ROOT = join(process.cwd(), "src");
const CSS = readFileSync(join(ROOT, "app", "globals.css"), "utf8");

/** The surfaces this app paints behind text. Declared, not guessed: a
 *  cross-product over every token would compare white text with white. */
const LIGHT_SURFACES = ["page", "card", "card-soft"] as const;

/** Surfaces that are not tokens: a severity colour washed over `card` at 8%,
 *  behind the findings rows. They are declared here so the guard measures text
 *  against them too — a tint is still a surface, and an unguarded one is how
 *  the next contrast failure gets in. */
const TINTED_SURFACES: Record<string, string> = {
  "card+error/8": "#fdf2f2",
  "card+warning/8": "#fef8ed",
  "card+success/8": "#f1f9f5",
};

/** A token painted only on one particular surface says so here. Each entry is
 *  a claim that the token never appears on a light surface — the portal header
 *  is `bg-brand-primary`, and its icons and text are measured against that. */
const SURFACE_OVERRIDE: Record<string, readonly string[]> = {
  "text-on-dark": ["brand-primary"],
  "brand-blue": ["brand-primary"],
  "brand-purple": ["brand-primary"],
  "brand-peach": ["brand-primary"],
};

/** Decorative and aria-hidden — it conveys nothing, so there is no floor. */
const DECORATIVE = new Set(["border-soft"]);

/** Tokens that colour an icon or a bar and never a word. They answer to the
 *  3:1 non-text bar. Adding one here claims no sentence is painted with it. */
const NON_TEXT = new Set(["error", "warning", "success", "accent", "accent-bright"]);

/** Known failures, each with the issue that owns it. A new one fails the
 *  build; a listed one that has been FIXED also fails the build, because the
 *  entry is then stale and must be deleted. The list cannot rot into an
 *  excuse. */
const KNOWN: Array<{ token: string; surface: string; issue: string }> = [
  // Body text at 4.21 / 3.90 / 3.74 — under the 4.5 text needs, everywhere.
  { token: "text-muted", surface: "page", issue: "#168" },
  { token: "text-muted", surface: "card", issue: "#168" },
  { token: "text-muted", surface: "card-soft", issue: "#168" },
  // Links and badge text at 2.87–3.23. Found by this guard on its first run.
  { token: "info", surface: "page", issue: "#168" },
  { token: "info", surface: "card", issue: "#168" },
  { token: "info", surface: "card-soft", issue: "#168" },
  // Icons below the 3:1 a non-text indicator needs. glance.tsx solves this
  // with a hairline ring; the rest of the app has not adopted it.
  { token: "warning", surface: "page", issue: "#168" },
  { token: "warning", surface: "card", issue: "#168" },
  { token: "warning", surface: "card-soft", issue: "#168" },
  { token: "success", surface: "page", issue: "#168" },
  { token: "success", surface: "card", issue: "#168" },
  { token: "success", surface: "card-soft", issue: "#168" },
  // The same four tokens against the tinted row surfaces. None is used on a
  // tinted row today — the findings rows carry text-secondary and the -strong
  // severity variants, which read 4.97 to 5.99 there. These entries say what
  // WOULD happen if one were, and they clear with the same fix as the rest.
  { token: "text-muted", surface: "card+error/8", issue: "#168" },
  { token: "text-muted", surface: "card+warning/8", issue: "#168" },
  { token: "text-muted", surface: "card+success/8", issue: "#168" },
  { token: "info", surface: "card+error/8", issue: "#168" },
  { token: "info", surface: "card+warning/8", issue: "#168" },
  { token: "info", surface: "card+success/8", issue: "#168" },
  { token: "warning", surface: "card+error/8", issue: "#168" },
  { token: "warning", surface: "card+warning/8", issue: "#168" },
  { token: "warning", surface: "card+success/8", issue: "#168" },
  { token: "success", surface: "card+error/8", issue: "#168" },
  { token: "success", surface: "card+warning/8", issue: "#168" },
  { token: "success", surface: "card+success/8", issue: "#168" },
];

function sourceText(): string {
  const parts: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) {
        if (entry !== "node_modules") walk(path);
      } else if (/\.(tsx?|css)$/.test(entry) && !entry.endsWith(".test.ts")) {
        parts.push(readFileSync(path, "utf8"));
      }
    }
  };
  walk(ROOT);
  return parts.join("\n");
}

function violations() {
  const tokens = parseTokens(CSS);
  const source = sourceText();
  const asText = usedAs("text", source, tokens);
  const out: Array<{ token: string; surface: string; ratio: number; need: number }> = [];
  for (const token of [...asText].sort()) {
    if (DECORATIVE.has(token)) continue;
    const need = NON_TEXT.has(token) ? AA_NON_TEXT : AA_TEXT;
    const surfaces = SURFACE_OVERRIDE[token]
      ? SURFACE_OVERRIDE[token].map((s) => [s, tokens[s]] as const)
      : [...LIGHT_SURFACES.map((s) => [s, tokens[s]] as const),
         ...Object.entries(TINTED_SURFACES)];
    for (const [surface, hex] of surfaces) {
      const ratio = contrastRatio(tokens[token], hex);
      if (ratio < need) out.push({ token, surface, ratio, need });
    }
  }
  return out;
}

const key = (v: { token: string; surface: string }) => `${v.token} on ${v.surface}`;

test("no colour token appears as text below its contrast floor", () => {
  const known = new Set(KNOWN.map(key));
  const fresh = violations().filter((v) => !known.has(key(v)));
  assert.deepEqual(
    fresh.map((v) => `${key(v)} = ${v.ratio.toFixed(2)} (needs ${v.need})`),
    [],
    "A token used as text fails contrast on a surface this app paints. Darken " +
      "the token, stop using it for words, or — if it is genuinely icon-only — " +
      "add it to NON_TEXT with a reason.",
  );
});

test("the known-failure list cannot rot — a fixed entry must be deleted", () => {
  const failing = new Set(violations().map(key));
  const stale = KNOWN.filter((k) => !failing.has(key(k)));
  assert.deepEqual(
    stale.map((k) => `${key(k)} (${k.issue})`),
    [],
    "These no longer fail. Delete them from KNOWN so the guard stays honest.",
  );
});

test("every known failure names the issue that owns it", () => {
  for (const k of KNOWN) assert.match(k.issue, /^#\d+$/, `${key(k)} needs an issue`);
});

// ── the maths, pinned against published values ──────────────────────────────

test("contrast ratio matches the WCAG reference points", () => {
  assert.equal(contrastRatio("#ffffff", "#000000").toFixed(0), "21");
  assert.equal(contrastRatio("#ffffff", "#ffffff").toFixed(0), "1");
  assert.equal(contrastRatio("#777777", "#ffffff").toFixed(2), "4.48");
  assert.equal(contrastRatio("#ffffff", "#777777"), contrastRatio("#777777", "#ffffff"));
});

test("a malformed colour is not silently treated as passing", () => {
  assert.equal(parseHex("not a colour"), null);
  assert.ok(Number.isNaN(contrastRatio("#ffffff", "rebeccapurple")));
});

test("token and usage parsing read the real files", () => {
  const tokens = parseTokens(CSS);
  assert.equal(tokens["card"], "#ffffff");
  assert.ok(Object.keys(tokens).length > 8);
  const used = usedAs("text", 'className="text-text-primary text-sm"', tokens);
  assert.ok(used.has("text-primary"));
  assert.ok(!used.has("primary"), "a partial name must not match a longer class");
  assert.ok(usedAs("bg", 'className="bg-error/10"', tokens).has("error"),
    "an opacity modifier still counts as a usage");
});
