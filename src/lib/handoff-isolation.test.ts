import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

function walk(dir: string, acc: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) {
      if (!p.includes("node_modules")) walk(p, acc);
    } else if (/\.(ts|tsx)$/.test(e) && !e.endsWith(".test.ts")) {
      acc.push(p.replace(/\\/g, "/"));
    }
  }
  return acc;
}
const files = walk("src");

// SPINE_SECRET is used only server-side. No client component may reference it or
// import the crypto-bearing handoff contract — signing happens server-side only.
test("no client component touches SPINE_SECRET or the handoff contract", () => {
  const clientFiles = files.filter((f) => {
    const s = readFileSync(f, "utf8");
    return /^"use client";/m.test(s);
  });
  for (const f of clientFiles) {
    const s = readFileSync(f, "utf8");
    assert.doesNotMatch(s, /SPINE_SECRET/, `${f} must not reference SPINE_SECRET`);
    assert.doesNotMatch(s, /handoff-contract/, `${f} must not import the handoff contract`);
  }
});

test("handoff signing lives only in server code", () => {
  // signHandoff/handoffUrl callers must be route handlers / server files.
  const callers = files.filter((f) => /\b(signHandoff|handoffUrl)\s*\(/.test(readFileSync(f, "utf8")) && !f.endsWith("handoff-contract.ts"));
  for (const f of callers) {
    assert.doesNotMatch(readFileSync(f, "utf8"), /^"use client";/m, `${f} signs handoff but is a client component`);
  }
});
