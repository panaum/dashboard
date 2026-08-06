import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
// Imported from the PURE module: the server-only sibling pulls in Prisma and
// `server-only`, neither of which resolves outside Next's bundler. The I/O
// behaviour of that sibling is asserted by reading its source, below.
import {
  clientIntelligenceEnabled,
  toClientPresence,
  type ClientIntelligencePayload,
  type WireChip,
} from "./client-intelligence-shape";
import type { ChipState } from "./chips-shape";

// ═══ CLIENT INTELLIGENCE — Dashboard consumption ═════════════════════════════
// Proves the chips LinkSpy returns actually reach the renderer, and that the
// aggregation is NOT redone here (one authority for one rule).

function wireChip(over: Partial<WireChip> = {}): WireChip {
  return {
    key: "ssl",
    label: "SSL",
    state: "critical" as ChipState,
    text: "⚠ on 1 of 3 sites",
    detail: null,
    affected: 1,
    total: 3,
    site_path: "/dashboard/s1",
    ...over,
  };
}

function payload(chips = [wireChip()]): ClientIntelligencePayload {
  return {
    registry_client_id: "rc-1",
    as_of: "2026-08-06T09:00:00.000Z",
    chip_keys: ["ssl", "sentinel", "incidents", "fragility"],
    site_count: 3,
    worst: "critical",
    chips,
    sites: {},
  };
}

// ── the flag ────────────────────────────────────────────────────────────────
test("CLIENT_INTELLIGENCE: only the exact string '1' turns it on", () => {
  assert.equal(clientIntelligenceEnabled({ CLIENT_INTELLIGENCE: "1" }), true);
  assert.equal(clientIntelligenceEnabled({ CLIENT_INTELLIGENCE: "true" }), false);
  assert.equal(clientIntelligenceEnabled({}), false);
});

test("the fetch is skipped entirely when the flag is off", () => {
  const src = readFileSync("src/lib/linkspy/client-intelligence.ts", "utf8");
  const gate = src.indexOf("if (!clientIntelligenceEnabled()");
  assert.ok(gate > -1, "the flag guards getClientIntelligence");
  assert.ok(gate < src.indexOf("fetchIntelligence(client.registryClientId)"),
    "flag off ⇒ LinkSpy is never contacted");
});

// ── nothing to show renders nothing ─────────────────────────────────────────
test("no payload, empty chips, or malformed chips all render nothing", () => {
  assert.equal(toClientPresence("c1", "Northbeam", null), null);
  assert.equal(toClientPresence("c1", "Northbeam", payload([])), null);
  assert.equal(
    toClientPresence("c1", "Northbeam", { ...payload(), chips: undefined as never }),
    null,
  );
});

test("a client with no registry annotation never reaches the network", () => {
  const src = readFileSync("src/lib/linkspy/client-intelligence.ts", "utf8");
  assert.match(src, /if \(!client\?\.registryClientId\) return HIDDEN;/);
});

// ── the endpoint's chips reach the renderer intact ──────────────────────────
test("wire chips map onto the shared AggregatedChip shape", () => {
  const p = toClientPresence("c1", "Northbeam", payload());
  assert.ok(p);
  assert.equal(p.clientId, "c1");
  assert.equal(p.clientName, "Northbeam");
  assert.equal(p.siteCount, 3);
  const chip = p.chips[0];
  assert.equal(chip.key, "ssl");
  assert.equal(chip.text, "⚠ on 1 of 3 sites", "the server's aggregated text is shown verbatim");
  assert.equal(chip.affected, 1);
  assert.equal(chip.total, 3);
  assert.equal(chip.sitePath, "/dashboard/s1", "snake_case site_path → camelCase sitePath");
});

test("all four chips survive the adapter with their own states", () => {
  const p = toClientPresence("c1", "N", payload([
    wireChip({ key: "ssl", state: "warn" }),
    wireChip({ key: "sentinel", state: "ok", text: "ok on 3 sites" }),
    wireChip({ key: "incidents", state: "critical", text: "⚠ on 1 of 3 sites" }),
    wireChip({ key: "fragility", state: "settling", text: "settling" }),
  ]));
  assert.deepEqual(p!.chips.map((c) => c.key), ["ssl", "sentinel", "incidents", "fragility"]);
  assert.deepEqual(p!.chips.map((c) => c.state), ["warn", "ok", "critical", "settling"]);
});

// ── aggregation happens ONCE, on the server ─────────────────────────────────
test("the adapter does not re-aggregate", () => {
  const src = readFileSync("src/lib/linkspy/client-intelligence.ts", "utf8");
  assert.doesNotMatch(src, /aggregateChip|clientPresence\(/,
    "aggregation is LinkSpy's job here — doing it twice is two authorities for one rule");
});

test("worst is recomputed from the chips actually rendered, not trusted from the wire", () => {
  // Wire claims "ok"; the chips say critical. The line must not lie.
  const p = toClientPresence("c1", "N", {
    ...payload([wireChip({ state: "critical" })]),
    worst: "ok" as ChipState,
  });
  assert.equal(p!.worst, "critical", "the headline can never disagree with the chips");
});

// ── a hostile / evolving producer can't break the page ──────────────────────
test("an absolute deep link is refused, never signed into a handoff", () => {
  const p = toClientPresence("c1", "N", payload([
    wireChip({ site_path: "https://evil.example/steal" }),
  ]));
  assert.equal(p!.chips[0].sitePath, null);
});

test("a missing detail degrades to null rather than undefined", () => {
  const p = toClientPresence("c1", "N", payload([wireChip({ detail: undefined as never })]));
  assert.equal(p!.chips[0].detail, null);
});

// ── staleness over errors, no blocking, no writes ───────────────────────────
test("unreachable LinkSpy serves last-known-good, then nothing", () => {
  const src = readFileSync("src/lib/linkspy/client-intelligence.ts", "utf8");
  assert.match(src, /payload = hit\?\.payload \?\? null;/);
  assert.match(src, /stale = Boolean\(hit\);/);
  assert.match(src, /AbortSignal\.timeout\(/, "a hung LinkSpy must not hang the client page");
  assert.match(src, /CACHE_MS = 60 \* 1000/);
  assert.match(src, /if \(!res\.ok\) return null;/, "404 (flag off upstream) is 'nothing here', not an error");
});

test("client intelligence never writes and never leaks the key", () => {
  const src = readFileSync("src/lib/linkspy/client-intelligence.ts", "utf8");
  assert.ok(src.startsWith('import "server-only";'));
  assert.doesNotMatch(src, /\.update\(|\.create\(|\.upsert\(|\.delete\(/);
  assert.match(src, /db\.client\s*\n?\s*\.findUnique/, "the only DB touch is a read of the annotation");
});

// ── precedence on the page ──────────────────────────────────────────────────
test("client intelligence wins over presence, and either can be absent", () => {
  const page = readFileSync("src/app/dashboard/clients/[clientId]/page.tsx", "utf8");
  assert.match(page, /const chipView = intelligence\.presence \? intelligence : presence;/,
    "the superset (sites.client_id) wins when it has chips");
  assert.match(page, /<ClientPresenceLine presence=\{chipView\.presence\}/,
    "one renderer for both sources — no second chip component");
  assert.match(page, /Promise\.all\(\[/, "the two lookups run concurrently, not in series");
});

// ── end-to-end render: endpoint payload → visible chips ─────────────────────
test("a payload from the endpoint renders four visible chips", async () => {
  const { renderToStaticMarkup } = await import("react-dom/server");
  const { ClientPresenceLine } = await import("@/components/qa/client-presence-line");

  const p = toClientPresence("c1", "Northbeam", payload([
    wireChip({ key: "ssl", label: "SSL", state: "warn", text: "⚠ on 1 of 3 sites" }),
    wireChip({ key: "sentinel", label: "Sentinel", state: "ok", text: "ok on 3 sites" }),
    wireChip({ key: "incidents", label: "Incidents", state: "critical", text: "⚠ on 1 of 3 sites" }),
    wireChip({ key: "fragility", label: "Fragility", state: "settling", text: "settling" }),
  ]));
  const html = renderToStaticMarkup(
    ClientPresenceLine({ presence: p, hrefByChip: {} }) as React.ReactElement,
  );

  assert.match(html, /Northbeam/);
  for (const label of ["SSL", "Sentinel", "Incidents", "Fragility"]) {
    assert.match(html, new RegExp(label), `${label} must render`);
  }
  assert.match(html, /🔴/, "worst-of leads the line");
  assert.match(html, /text-error/, "the critical chip is red…");
  assert.match(html, /text-success/, "…and the healthy chip stays green beside it");
  assert.match(html, /settling/);
  assert.doesNotMatch(html, /score/i, "no composite ever renders");
});

test("nothing to show emits zero bytes", async () => {
  const { renderToStaticMarkup } = await import("react-dom/server");
  const { ClientPresenceLine } = await import("@/components/qa/client-presence-line");
  const html = renderToStaticMarkup(
    ClientPresenceLine({ presence: null, hrefByChip: {} }) as React.ReactElement,
  );
  assert.equal(html, "", "flag off / unannotated client contributes nothing to the DOM");
});
