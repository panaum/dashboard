import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(p, "utf8");

// The LinkSpy key is read ONLY in the server-only registry client.
test("registry.ts is server-only", () => {
  assert.match(read("src/lib/registry.ts"), /^import "server-only";/m);
});

// No client-tree file may reference the key/env or import the server-only lib —
// guarantees LINKSPY_API_KEY is never bundled for the browser.
test("client components never touch the key, env, or the server-only registry lib", () => {
  const clientTree = [
    "src/components/qa/registry-link.tsx",
    "src/components/qa/registry-create-field.tsx",
  ];
  for (const f of clientTree) {
    const src = read(f);
    assert.ok(/^"use client";/m.test(src), `${f} must be a client component`);
    assert.doesNotMatch(src, /LINKSPY_API_KEY/, `${f} must not mention LINKSPY_API_KEY`);
    assert.doesNotMatch(src, /process\.env\.LINKSPY/, `${f} must not read a LINKSPY env var`);
    assert.doesNotMatch(src, /@\/lib\/registry\b/, `${f} must not import the server-only registry lib`);
    assert.doesNotMatch(src, /server-only/, `${f} must stay client-safe`);
  }
});

// The client reaches the registry ONLY through our proxy routes (which hold the
// key server-side).
test("client components call the proxy routes, not LinkSpy directly", () => {
  const src = read("src/components/qa/registry-link.tsx")
    + read("src/components/qa/registry-create-field.tsx");
  assert.match(src, /\/api\/registry\/clients/, "should fetch the local proxy");
  assert.doesNotMatch(src, /LINKSPY_API_URL/, "must not target LinkSpy directly");
});
