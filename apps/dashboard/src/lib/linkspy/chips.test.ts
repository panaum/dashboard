import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  aggregateChip,
  clientPresence,
  presenceEnabled,
  stateEmoji,
  worstState,
  STATE_ORDER,
  type ChipState,
  type SitePresence,
  type SitesPayload,
} from "./chips-shape";

// ═══ CLIENT PRESENCE CHIPS — Dashboard side ══════════════════════════════════
// Four signals, aggregated independently. The only reduction is worst-of.

const CHIP_KEYS = ["ssl", "sentinel", "incidents", "fragility"];

function site(states: Partial<Record<string, ChipState>>, path = "/dashboard/s1"): SitePresence {
  const chips = CHIP_KEYS.map((key) => ({
    key,
    state: states[key] ?? ("ok" as ChipState),
    label: { ssl: "SSL", sentinel: "Sentinel", incidents: "Incidents", fragility: "Fragility" }[key]!,
    text: states[key] && states[key] !== "ok" ? "3 days" : "ok",
    detail: `${key} detail`,
  }));
  return { site_path: path, chips, worst: worstState(chips.map((c) => c.state)) };
}

function payload(sites: Record<string, SitePresence>): SitesPayload {
  return { as_of: "2026-08-05T09:00:00.000Z", chip_keys: CHIP_KEYS, sites };
}

// ── the flag ────────────────────────────────────────────────────────────────
test("PRESENCE flag: only the exact string '1' turns it on", () => {
  assert.equal(presenceEnabled({ PRESENCE: "1" }), true);
  assert.equal(presenceEnabled({ PRESENCE: "true" }), false);
  assert.equal(presenceEnabled({}), false);
});

// ── unmapped clients render nothing ─────────────────────────────────────────
test("a client with no linked site returns null", () => {
  const p = clientPresence({
    clientId: "c1", clientName: "Northbeam", siteIds: [],
    payload: payload({ s1: site({}) }),
  });
  assert.equal(p, null, "unmapped clients must be byte-identical to today");
});

test("a client whose sites are absent from the payload returns null", () => {
  const p = clientPresence({
    clientId: "c1", clientName: "Northbeam", siteIds: ["missing"],
    payload: payload({ s1: site({}) }),
  });
  assert.equal(p, null);
});

test("no payload at all (LinkSpy unreachable, no cache) returns null", () => {
  const p = clientPresence({ clientId: "c1", clientName: "N", siteIds: ["s1"], payload: null });
  assert.equal(p, null);
});

// ── four chips, always, each with its own state ─────────────────────────────
test("a healthy client still renders all four chips (this is a status board)", () => {
  const p = clientPresence({
    clientId: "c1", clientName: "Northbeam", siteIds: ["s1"], payload: payload({ s1: site({}) }),
  });
  assert.ok(p);
  assert.deepEqual(p.chips.map((c) => c.key), CHIP_KEYS);
  assert.equal(p.worst, "ok");
  assert.deepEqual(p.chips.map((c) => c.state), ["ok", "ok", "ok", "ok"]);
});

test("one bad chip never colours the others", () => {
  const p = clientPresence({
    clientId: "c1", clientName: "N", siteIds: ["s1"],
    payload: payload({ s1: site({ ssl: "critical" }) }),
  });
  assert.ok(p);
  const by = Object.fromEntries(p.chips.map((c) => [c.key, c.state]));
  assert.deepEqual(by, { ssl: "critical", sentinel: "ok", incidents: "ok", fragility: "ok" });
  assert.equal(p.worst, "critical", "the line's worst is critical…");
  assert.equal(by.sentinel, "ok", "…but the sentinel chip stays green");
});

// ── multi-site aggregation ──────────────────────────────────────────────────
test("each chip aggregates on its own axis across sites", () => {
  const p = clientPresence({
    clientId: "c1", clientName: "Northbeam", siteIds: ["s1", "s2", "s3"],
    payload: payload({
      s1: site({ ssl: "warn" }, "/dashboard/s1"),
      s2: site({ fragility: "critical" }, "/dashboard/s2"),
      s3: site({}, "/dashboard/s3"),
    }),
  });
  assert.ok(p);
  const by = Object.fromEntries(p.chips.map((c) => [c.key, c]));
  assert.equal(by.ssl.state, "warn");
  assert.equal(by.ssl.text, "⚠ on 1 of 3 sites");
  assert.equal(by.fragility.state, "critical");
  assert.equal(by.fragility.text, "⚠ on 1 of 3 sites");
  assert.equal(by.sentinel.state, "ok");
  assert.equal(by.sentinel.text, "ok on 3 sites");
  assert.equal(p.worst, "critical");
});

test("ONE red among many greens is never hidden", () => {
  const sites: Record<string, SitePresence> = {};
  const ids: string[] = [];
  for (let i = 0; i < 29; i++) { sites[`s${i}`] = site({}); ids.push(`s${i}`); }
  sites.bad = site({ incidents: "critical" });
  ids.push("bad");

  const p = clientPresence({ clientId: "c1", clientName: "N", siteIds: ids, payload: payload(sites) });
  assert.ok(p);
  const incidents = p.chips.find((c) => c.key === "incidents")!;
  assert.equal(incidents.state, "critical", "29 greens must not outvote one red");
  assert.equal(incidents.text, "⚠ on 1 of 30 sites");
  assert.equal(p.worst, "critical");
});

test("a single-site client states the fact, without counting", () => {
  const p = clientPresence({
    clientId: "c1", clientName: "N", siteIds: ["s1"],
    payload: payload({ s1: site({ ssl: "critical" }) }),
  });
  const ssl = p!.chips.find((c) => c.key === "ssl")!;
  assert.equal(ssl.text, "3 days", "one site: no '1 of 1' noise");
  assert.equal(ssl.total, 1);
});

test("counts reflect how many sites are AT the worst state", () => {
  const chip = aggregateChip("ssl", [
    { id: "a", presence: site({ ssl: "critical" }, "/dashboard/a") },
    { id: "b", presence: site({ ssl: "critical" }, "/dashboard/b") },
    { id: "c", presence: site({ ssl: "ok" }, "/dashboard/c") },
  ])!;
  assert.equal(chip.state, "critical");
  assert.equal(chip.affected, 2);
  assert.equal(chip.total, 3);
  assert.equal(chip.text, "⚠ on 2 of 3 sites");
});

// ── deep links: only when one site is implicated ────────────────────────────
test("a chip links out only when exactly one site is implicated", () => {
  const one = aggregateChip("ssl", [
    { id: "a", presence: site({ ssl: "critical" }, "/dashboard/a") },
    { id: "b", presence: site({ ssl: "ok" }, "/dashboard/b") },
  ])!;
  assert.equal(one.sitePath, "/dashboard/a");
  assert.equal(one.detail, "ssl detail", "one implicated site → its own detail");

  const many = aggregateChip("ssl", [
    { id: "a", presence: site({ ssl: "critical" }, "/dashboard/a") },
    { id: "b", presence: site({ ssl: "critical" }, "/dashboard/b") },
  ])!;
  assert.equal(many.sitePath, null, "pointing 'two sites' at one of them would be a lie");
  assert.equal(many.detail, null);
});

// ── worst-of ────────────────────────────────────────────────────────────────
test("worst-of ladder matches the producer's", () => {
  assert.deepEqual(STATE_ORDER, ["critical", "warn", "notice", "settling", "unknown", "ok"]);
  assert.equal(worstState(["ok", "critical", "notice"]), "critical");
  assert.equal(worstState(["ok", "warn"]), "warn");
  assert.equal(worstState([]), "unknown");
  assert.equal(worstState([undefined, undefined]), "unknown");
});

test("settling is neither green nor red", () => {
  assert.equal(worstState(["ok", "settling"]), "settling");
  assert.equal(worstState(["notice", "settling"]), "notice");
});

test("a fresh-site client does not read as healthy", () => {
  const p = clientPresence({
    clientId: "c1", clientName: "N", siteIds: ["s1"],
    payload: payload({ s1: site({ fragility: "settling" }) }),
  });
  assert.equal(p!.worst, "settling");
  assert.notEqual(p!.worst, "ok", "settling must never present as green");
});

test("the line's worst can never disagree with the chips it shows", () => {
  const p = clientPresence({
    clientId: "c1", clientName: "N", siteIds: ["s1", "s2"],
    payload: payload({ s1: site({ sentinel: "warn" }), s2: site({ ssl: "notice" }) }),
  });
  assert.ok(p);
  assert.equal(p.worst, worstState(p.chips.map((c) => c.state)));
});

test("every state has a distinct-enough glyph, and unknown never crashes", () => {
  assert.equal(stateEmoji("critical"), "🔴");
  assert.equal(stateEmoji("ok"), "🟢");
  assert.equal(stateEmoji("settling"), "⚪");
  assert.equal(stateEmoji("bogus" as ChipState), "⚪");
});

// ── NO COMPOSITE, anywhere ──────────────────────────────────────────────────
test("no file in the chips pipeline computes a blended score", () => {
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  for (const f of [
    "src/lib/linkspy/chips-shape.ts",
    "src/lib/linkspy/client-presence.ts",
    "src/components/qa/client-presence-line.tsx",
    "src/app/api/presence/clients/route.ts",
  ]) {
    const code = strip(readFileSync(f, "utf8"));
    for (const banned of ["weight", "* 0.", "/ length", "reduce((a, b) => a +", "average", "healthScore"]) {
      assert.ok(!code.includes(banned), `${f} must not blend signals — found ${banned}`);
    }
  }
});

test("the client dot exposes a named cause, never a bare verdict", () => {
  const src = readFileSync("src/app/api/presence/clients/route.ts", "utf8");
  assert.match(src, /worstChip\.label/, "the tooltip names which chip is worst");
  assert.doesNotMatch(src, /score/i, "no composite reaches the dot");
});

// ── read-only + server-only ─────────────────────────────────────────────────
test("presence never writes, and the key never leaves the server", () => {
  const lib = readFileSync("src/lib/linkspy/client-presence.ts", "utf8");
  assert.ok(lib.startsWith('import "server-only";'));
  assert.doesNotMatch(lib, /\.update\(|\.create\(|\.upsert\(|\.delete\(/);
  assert.match(lib, /db\.page\s*\n?\s*\.findMany/, "the only DB touch is a read of page annotations");

  const line = readFileSync("src/components/qa/client-presence-line.tsx", "utf8");
  assert.doesNotMatch(line, /LINKSPY_API_KEY|SPINE_SECRET|signHandoff|process\.env/);
  assert.doesNotMatch(line, /"use client"/, "server component — no secret reaches the browser");
});

test("the list route is timeout-bounded upstream and caps loudly", () => {
  const lib = readFileSync("src/lib/linkspy/client-presence.ts", "utf8");
  assert.match(lib, /AbortSignal\.timeout\(/);
  assert.match(lib, /CACHE_MS = 60 \* 1000/, "60s at the Dashboard fetch");
  assert.match(lib, /console\.warn\(/, "a dropped site must be reported, not hidden");
});

test("the client directory never blocks on presence", () => {
  const src = readFileSync("src/components/clients/client-directory.tsx", "utf8");
  assert.match(src, /useEffect\(/, "dots load after paint");
  assert.match(src, /if \(!dot\) return null;/, "no dot, no reserved space");
  assert.match(src, /\.catch\(\(\) => \{\}\)/, "a failed fetch is silent");
});

// ── flag-off renders nothing, proven by rendering ───────────────────────────
test("the presence line emits ZERO bytes when there is no presence", async () => {
  const { renderToStaticMarkup } = await import("react-dom/server");
  const { ClientPresenceLine } = await import("@/components/qa/client-presence-line");
  const html = renderToStaticMarkup(
    ClientPresenceLine({ presence: null, hrefByChip: {} }) as React.ReactElement,
  );
  assert.equal(html, "", "flag off / unmapped must contribute nothing to the DOM");
});

test("all four chips render, each in its own tone", async () => {
  const { renderToStaticMarkup } = await import("react-dom/server");
  const { ClientPresenceLine } = await import("@/components/qa/client-presence-line");

  const p = clientPresence({
    clientId: "c1", clientName: "Northbeam", siteIds: ["s1", "s2", "s3"],
    payload: payload({
      s1: site({ ssl: "warn" }), s2: site({ incidents: "critical" }), s3: site({ fragility: "settling" }),
    }),
  })!;
  const html = renderToStaticMarkup(
    ClientPresenceLine({ presence: p, hrefByChip: {} }) as React.ReactElement,
  );

  assert.match(html, /Northbeam/);
  for (const label of ["SSL", "Sentinel", "Incidents", "Fragility"]) {
    assert.match(html, new RegExp(label), `${label} chip must be visible`);
  }
  assert.match(html, /🔴/, "worst-of emoji leads the line");
  assert.match(html, /text-error/, "the critical chip carries the error tone");
  assert.match(html, /text-success/, "…and a healthy chip stays green in the same line");
  assert.doesNotMatch(html, /score/i, "no composite number is ever rendered");
});
