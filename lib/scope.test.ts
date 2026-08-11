import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

// ═══ NO CROSS-CONTAMINATION ═══
//
// The Living Certificate palette is light; the rest of the shell is dark. Both
// live in one Tailwind config and one stylesheet, so the separation is a
// convention — and a convention that nothing checks is a convention that decays.
// These tests are the check.
//
// The rule: `lc-*` utilities and the `lc-root` class may appear ONLY under
// app/live/ and in the components it owns. Every other surface — the doors page,
// sign-in, handoff — must be provably untouched.

const ROOT = new URL("..", import.meta.url).pathname;
const LIVE_OWNED = [
  "app/live",
  "components/StoryHeader.tsx",
  "components/VerificationCounters.tsx",
];

function walk(dir: string): string[] {
  const out: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(join(ROOT, dir));
  } catch {
    return out;
  }
  for (const e of entries) {
    const rel = join(dir, e);
    if (statSync(join(ROOT, rel)).isDirectory()) out.push(...walk(rel));
    else if (/\.tsx?$/.test(e) && !/\.test\.tsx?$/.test(e)) out.push(rel);
  }
  return out;
}

const isLiveOwned = (f: string) => LIVE_OWNED.some((p) => f === p || f.startsWith(p + "/"));

const sourceFiles = [...walk("app"), ...walk("components"), ...walk("lib")];

test("the shell has surfaces other than /live/ to protect", () => {
  const others = sourceFiles.filter((f) => !isLiveOwned(f));
  assert.ok(others.length >= 5, `expected other surfaces, found ${others.length}`);
  assert.ok(others.includes("app/page.tsx"), "the doors page must be among them");
});

test("no surface outside /live/ uses the ported palette", () => {
  for (const f of sourceFiles.filter((x) => !isLiveOwned(x))) {
    const src = readFileSync(join(ROOT, f), "utf8");
    assert.doesNotMatch(src, /\blc-root\b/, `${f} must not claim the /live/ scope`);
    assert.doesNotMatch(
      src,
      /\b(?:bg|text|border|shadow|font|from|to|via|ring|fill|stroke|divide)-lc\b/,
      `${f} must not use a ported lc-* token`,
    );
  }
});

// The ground swap keys on .lc-root. If more than one place sets it, the scope
// has more than one door and this whole guarantee weakens.
test("exactly one file establishes the /live/ scope", () => {
  const setters = sourceFiles.filter((f) =>
    /className=\{?[^}]*\blc-root\b/.test(readFileSync(join(ROOT, f), "utf8")),
  );
  assert.deepEqual(setters, ["app/live/layout.tsx"]);
});

// The dark palette must survive intact — a port is additive, never a rewrite.
test("the shell's own dark tokens are untouched", () => {
  const cfg = readFileSync(join(ROOT, "tailwind.config.ts"), "utf8");
  for (const token of ['950: "#08080c"', '850: "#101018"', 'signal:', 'line: "#23232f"']) {
    assert.ok(cfg.includes(token), `dark token ${token} must remain`);
  }
  const css = readFileSync(join(ROOT, "app/globals.css"), "utf8");
  assert.match(css, /radial-gradient\(1200px 700px/, "the doors' gradient must remain");
  assert.match(css, /color-scheme: dark/, "the shell's dark color-scheme must remain");
});

// The light ground applies only when .lc-root is present.
test("the light ground is conditional, never global", () => {
  const css = readFileSync(join(ROOT, "app/globals.css"), "utf8");
  for (const rule of ["body:has(.lc-root)", "html:has(.lc-root)"]) {
    assert.ok(css.includes(rule), `${rule} must scope the swap`);
  }
  // Walk every rule: the light ground may appear ONLY in :has(.lc-root) rules,
  // and the dark gradient must still be painted by an unscoped one.
  const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
    selector: m[1].trim(),
    body: m[2],
  }));

  for (const r of rules) {
    if (r.body.includes("#f6f6f9") || r.body.includes("#1c1c2e")) {
      assert.match(
        r.selector,
        /:has\(\.lc-root\)|\.lc-root/,
        `light palette leaked into unscoped rule "${r.selector}"`,
      );
    }
  }

  const darkGround = rules.find((r) => r.body.includes("#08080c"));
  assert.ok(darkGround, "an unscoped rule must still paint the dark ground");
  assert.doesNotMatch(
    darkGround.selector,
    /lc-root/,
    "the dark ground must stay unconditional",
  );
});
