import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

// The secret is read ONLY in the server-only client module.
test("client.ts is server-only", () => {
  const src = read("src/lib/linkspy/client.ts");
  assert.match(src, /^import "server-only";/m, "client.ts must import 'server-only'");
});

// No client-tree file may reference the LinkSpy key or env — guarantees the
// secret is never bundled into the browser.
test("no client-side file references the LinkSpy API key or env", () => {
  const clientTree = [
    "src/components/qa/qa-checklist.tsx", // "use client"
    "src/components/qa/still-true.tsx", //   imported by the client checklist
    "src/lib/linkspy/catalog-map.ts", //     imported by client + server
  ];
  for (const f of clientTree) {
    const src = read(f);
    assert.doesNotMatch(src, /LINKSPY_API_KEY/, `${f} must not mention LINKSPY_API_KEY`);
    assert.doesNotMatch(src, /process\.env\.LINKSPY/, `${f} must not read a LINKSPY env var`);
    assert.doesNotMatch(src, /server-only/, `${f} must stay client-safe (no server-only import)`);
  }
});

// Client-safe modules must not import the server-only client (which would drag
// the secret into the client graph).
test("client-safe modules do not import the server-only client", () => {
  for (const f of ["src/components/qa/still-true.tsx", "src/lib/linkspy/catalog-map.ts"]) {
    assert.doesNotMatch(read(f), /linkspy\/client/, `${f} must not import linkspy/client`);
  }
});
