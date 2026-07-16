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
const ROUTE = "src/app/api/registry-bridge/delivery/route.ts";

test("DASHBOARD_BRIDGE_KEY never appears in a client component", () => {
  const clientFiles = files.filter((f) => /^"use client";/m.test(readFileSync(f, "utf8")));
  for (const f of clientFiles) {
    assert.doesNotMatch(readFileSync(f, "utf8"), /DASHBOARD_BRIDGE_KEY/, `${f} must not reference the bridge key`);
  }
});

test("delivery read API enforces service-key auth + rate limit + required param", () => {
  const src = readFileSync(ROUTE, "utf8");
  assert.match(src, /DASHBOARD_BRIDGE_KEY/, "reads the service key");
  assert.match(src, /Bearer \$\{secret\}/, "checks Authorization: Bearer");
  assert.match(src, /status:\s*401/, "returns 401 on bad key");
  assert.match(src, /status:\s*429/, "rate limited");
  assert.match(src, /registry_site_id/, "requires registry_site_id");
  assert.match(src, /deep_link_path/, "returns a deep link path");
});
