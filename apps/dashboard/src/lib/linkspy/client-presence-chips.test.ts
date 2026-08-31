import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
// Imported from the PURE module: the server-only sibling pulls in Prisma and
// `server-only`, neither of which resolves outside Next's bundler. The I/O
// behaviour of that sibling is asserted by reading its source, below.
import {
  presenceChipsEnabled,
  toClientPresence,
  type ClientPresencePayload,
  type WireChip,
} from "./client-presence-chips-shape";
import type { ChipState } from "./chips-shape";

// ═══ CLIENT PRESENCE CHIPS — Dashboard consumption ═════════════════════════════
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

function payload(chips = [wireChip()]): ClientPresencePayload {
  return {
    registry_client_id: "rc-1",
    as_of: "2026-08-06T09:00:00.000Z",
    chip_keys: ["ssl", "sentinel", "incidents", "fragility"],
    site_count: 3,
    worst: "critical",
    worst_label: "brittle",
    chips,
    sites_summary: { total: 3, by_state: { critical: 1, ok: 2 }, by_label: { brittle: 1, stable: 2 } },
  };
}

// ── the flag ────────────────────────────────────────────────────────────────
test("PRESENCE_CHIPS: only the exact string '1' turns it on", () => {
  assert.equal(presenceChipsEnabled({ PRESENCE_CHIPS: "1" }), true);
  assert.equal(presenceChipsEnabled({ PRESENCE_CHIPS: "true" }), false);
  assert.equal(presenceChipsEnabled({}), false);
});

test("the fetch is skipped entirely when the flag is off", () => {
  const src = readFileSync("src/lib/linkspy/client-presence-chips.ts", "utf8");
  const gate = src.indexOf("if (!presenceChipsEnabled()");
  assert.ok(gate > -1, "the flag guards getClientPresenceChips");
  assert.ok(gate < src.indexOf("fetchPresenceChips(client.registryClientId)"),
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
  const src = readFileSync("src/lib/linkspy/client-presence-chips.ts", "utf8");
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
  const src = readFileSync("src/lib/linkspy/client-presence-chips.ts", "utf8");
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
  const src = readFileSync("src/lib/linkspy/client-presence-chips.ts", "utf8");
  assert.match(src, /payload = hit\?\.payload \?\? null;/);
  assert.match(src, /stale = Boolean\(hit\);/);
  assert.match(src, /AbortSignal\.timeout\(/, "a hung LinkSpy must not hang the client page");
  assert.match(src, /CACHE_MS = 60 \* 1000/);
  assert.match(src, /if \(!res\.ok\) return null;/, "404 (flag off upstream) is 'nothing here', not an error");
});

test("client presence chips never writes and never leaks the key", () => {
  const src = readFileSync("src/lib/linkspy/client-presence-chips.ts", "utf8");
  assert.ok(src.startsWith('import "server-only";'));
  assert.doesNotMatch(src, /\.update\(|\.create\(|\.upsert\(|\.delete\(/);
  assert.match(src, /db\.client\s*\n?\s*\.findUnique/, "the only DB touch is a read of the annotation");
});

// ── precedence on the page ──────────────────────────────────────────────────
test("client presence chips wins over presence, and either can be absent", () => {
  const page = readFileSync("src/app/dashboard/clients/[clientId]/page.tsx", "utf8");
  assert.match(page, /const chipView = chipsView\.presence \? chipsView : presence;/,
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

// ═══ Decision 1 — unmapped clients are never silent ══════════════════════════
test("an unlinked client renders a 'not linked' strip, not nothing", async () => {
  const { renderToStaticMarkup } = await import("react-dom/server");
  const { NotLinkedStrip } = await import("@/components/qa/client-presence-line");
  const html = renderToStaticMarkup(NotLinkedStrip({}) as React.ReactElement);
  assert.match(html, /Not linked to LinkSpy/);
  assert.match(html, /no production signals for this client/);
  assert.doesNotMatch(html, /text-success|text-error/, "absence of data is not a verdict");
});

test("the page shows the strip only when the flag is on and the client is unlinked", () => {
  const page = readFileSync("src/app/dashboard/clients/[clientId]/page.tsx", "utf8");
  assert.match(page, /presenceChipsEnabled\(\) && !client\.registryClientId/,
    "flag off ⇒ still byte-identical; linked ⇒ chips, not the strip");
  assert.match(page, /<NotLinkedStrip[\s\S]*?LinkClientButton/,
    "the strip carries the action that resolves it");
});

// ═══ Decision 2 — the ranking is pinned on this side too ════════════════════
test("RANKING_BEST_FIRST is pinned and matches the state ladder reversed", async () => {
  const { RANKING_BEST_FIRST, STATE_ORDER, stateLabel } = await import("./chips-shape");
  assert.deepEqual([...RANKING_BEST_FIRST], ["stable", "fresh", "drifting", "fragile", "brittle"]);
  const internalBestFirst = [...STATE_ORDER].reverse().filter((s) => s !== "unknown");
  assert.deepEqual(internalBestFirst.map(stateLabel), [...RANKING_BEST_FIRST],
    "one order, two names — a reorder on either side fails here");
});

test("every state has exactly one label and unknown stays off the ranking", async () => {
  const { STATE_ORDER, stateLabel, RANKING_BEST_FIRST } = await import("./chips-shape");
  const labels = STATE_ORDER.map(stateLabel);
  assert.equal(new Set(labels).size, labels.length, "no two states share a label");
  assert.equal(stateLabel("unknown"), "unknown");
  assert.ok(!RANKING_BEST_FIRST.includes("unknown" as never),
    "'could not tell' is not a point on a durability scale");
});

// ═══ Decision 3 — counts-only summary reaches the renderer ══════════════════
test("the sites summary carries counts by label, and no identity", () => {
  const p = toClientPresence("c1", "N", payload());
  assert.deepEqual(p!.sitesByLabel, { brittle: 1, stable: 2 });
  const flat = JSON.stringify(p!.sitesByLabel);
  assert.ok(!flat.includes("/dashboard/"), "no site paths in the summary");
  assert.ok(!/rc-1|s1|s2|s3/.test(flat), "no site ids or names in the summary");
});

test("a payload without a summary still renders chips", () => {
  const p = toClientPresence("c1", "N", { ...payload(), sites_summary: undefined });
  assert.ok(p, "the summary is additive — its absence must not blank the line");
  assert.equal(p.sitesByLabel, undefined);
});

// ═══ Decision 5 — linking is deliberate, single, and write-guarded ══════════
test("the link action writes exactly one annotation column and no QA row", () => {
  const src = readFileSync("src/app/dashboard/clients/[clientId]/link-actions.ts", "utf8");
  assert.match(src, /data: \{ registryClientId: body\.linkspy_client_id \}/);
  assert.doesNotMatch(src, /qACheckItem|certificate|page\.update/i,
    "linking must never touch a QA row (T4)");
  const updates = src.match(/db\.\w+\.update\(/g) ?? [];
  assert.equal(updates.length, 1, "exactly one write in the whole action");
});

test("the link action is flag-gated and annotates only after LinkSpy confirms", () => {
  const src = readFileSync("src/app/dashboard/clients/[clientId]/link-actions.ts", "utf8");
  assert.ok(src.indexOf("presenceChipsEnabled()") < src.indexOf("fetch("),
    "flag off ⇒ LinkSpy is never contacted");
  assert.ok(src.indexOf("body.linkspy_client_id") < src.indexOf("db.client.update"),
    "the registry id must exist before we record it");
});

test("linking is idempotent and never re-links an already-linked client", () => {
  const src = readFileSync("src/app/dashboard/clients/[clientId]/link-actions.ts", "utf8");
  assert.match(src, /if \(client\.registryClientId\) \{[\s\S]*?return \{ ok: true/,
    "already linked is a success, not an error, and mints nothing new");
});

test("no bulk-link path exists anywhere on the Dashboard", () => {
  for (const f of [
    "src/app/dashboard/clients/[clientId]/link-actions.ts",
    "src/components/qa/link-client-button.tsx",
  ]) {
    const src = readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    for (const bulk of ["findMany", "forEach", "for (const c", ".map(async"]) {
      assert.ok(!src.includes(bulk), `${f} must link one client at a time — found ${bulk}`);
    }
  }
});

// ═══ The renamed contract ════════════════════════════════════════════════════
// This side now speaks client-presence. LinkSpy has NOT been renamed yet (that
// was explicitly out of scope), so until it is, the fetch 404s and the surface
// renders the not-linked strip. These tests pin what LinkSpy must serve.
test("the Dashboard calls the client-presence endpoint under registry-bridge", () => {
  const src = readFileSync("src/lib/linkspy/client-presence-chips.ts", "utf8");
  assert.match(src, /\/api\/registry-bridge\/client-presence\?registry_client_id=/,
    "PENDING on LinkSpy: it still serves /api/qa-bridge/client-intelligence");
  assert.doesNotMatch(src, /client-intelligence/, "no stale endpoint name survives");
});

test("the flag is PRESENCE_CHIPS everywhere on this side", () => {
  for (const f of [
    "src/lib/linkspy/client-presence-chips-shape.ts",
    "src/lib/linkspy/client-presence-chips.ts",
    "src/app/dashboard/clients/[clientId]/link-actions.ts",
    "src/app/dashboard/clients/[clientId]/page.tsx",
  ]) {
    const src = readFileSync(f, "utf8");
    assert.ok(!src.includes("CLIENT_INTELLIGENCE"), `${f} must not read the old flag`);
  }
  const shape = readFileSync("src/lib/linkspy/client-presence-chips-shape.ts", "utf8");
  assert.match(shape, /env\.PRESENCE_CHIPS === "1"/, "only the literal 1 enables it");
});

test("the link endpoint keeps its name — only the read endpoint was renamed", () => {
  const src = readFileSync("src/app/dashboard/clients/[clientId]/link-actions.ts", "utf8");
  assert.match(src, /\/api\/registry-bridge\/link-client/,
    "link-client was already correctly namespaced and is unchanged");
});
