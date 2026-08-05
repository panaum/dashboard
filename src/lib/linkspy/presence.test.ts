import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  decidePresence,
  normalize,
  presenceEnabled,
  type PresencePayload,
  type PresenceSignal,
} from "./presence-shape";
import { firstName } from "@/app/api/registry-bridge/delivery/route";

// ═══ PRESENCE — Dashboard side ═══════════════════════════════════════════════
// Every state the production-presence strip can be in, decided by a pure
// function so none of this needs a network, a DB or a renderer.

function signal(over: Partial<PresenceSignal> = {}): PresenceSignal {
  return {
    key: "ssl",
    severity: "critical",
    text: "SSL certificate expires in 3 days",
    qualifier: "monitoring holding",
    deep_link_path: "/dashboard/site-1",
    ...over,
  };
}

function payload(signals: PresenceSignal[]): PresencePayload {
  return {
    registry_site_id: "site-1",
    as_of: "2026-08-05T09:00:00.000Z",
    last_checked: "2026-08-05T06:00:00.000Z",
    open_incidents: signals.filter((s) => s.key === "incident").length,
    site_path: "/dashboard/site-1",
    signals,
  };
}

const ON = { enabled: true, registrySiteId: "site-1", unreachable: false };

// ── the flag ────────────────────────────────────────────────────────────────
test("PRESENCE flag: only the exact string '1' turns it on", () => {
  assert.equal(presenceEnabled({ PRESENCE: "1" }), true);
  assert.equal(presenceEnabled({ PRESENCE: "0" }), false);
  assert.equal(presenceEnabled({ PRESENCE: "true" }), false, "half-on is not a state");
  assert.equal(presenceEnabled({}), false);
});

test("flag off renders nothing, even with signals in hand", () => {
  const view = decidePresence({ ...ON, enabled: false, payload: payload([signal()]) });
  assert.deepEqual(view, { render: false }, "flag off must be byte-identical to today");
});

// ── quiet by design ─────────────────────────────────────────────────────────
test("a healthy site renders NO strip (there is no 'all good' state)", () => {
  assert.deepEqual(decidePresence({ ...ON, payload: payload([]) }), { render: false });
});

test("a page with no linked registry site renders nothing", () => {
  assert.deepEqual(
    decidePresence({ ...ON, registrySiteId: null, payload: payload([signal()]) }),
    { render: false },
  );
});

// ── signals ─────────────────────────────────────────────────────────────────
test("one signal renders one line", () => {
  const view = decidePresence({ ...ON, payload: payload([signal()]) });
  assert.equal(view.render, true);
  assert.equal(view.kind, "signals");
  if (view.render && view.kind === "signals") {
    assert.equal(view.signals.length, 1);
    assert.equal(view.signals[0].text, "SSL certificate expires in 3 days");
    assert.equal(view.signals[0].qualifier, "monitoring holding");
    assert.equal(view.stale, false);
  }
});

test("three signals keep the order LinkSpy sorted them into", () => {
  const sigs = [
    signal({ key: "incident", text: "1 open incident", qualifier: "disaster sentinel" }),
    signal({ key: "index", text: "Search visibility at risk" }),
    signal({ key: "domain", severity: "warn", text: "Domain registration expires in 9 days" }),
  ];
  const view = decidePresence({ ...ON, payload: payload(sigs) });
  assert.equal(view.render && view.kind, "signals");
  if (view.render && view.kind === "signals") {
    assert.deepEqual(view.signals.map((s) => s.key), ["incident", "index", "domain"]);
    assert.deepEqual(view.signals.map((s) => s.severity), ["critical", "critical", "warn"]);
  }
});

// ── staleness over errors (constitution rule 6) ─────────────────────────────
test("unreachable with no cache renders one quiet 'unavailable' line", () => {
  const view = decidePresence({ ...ON, payload: null, unreachable: true });
  assert.deepEqual(view, { render: true, kind: "unavailable" });
});

test("unreachable WITH cache renders last-known-good, marked stale", () => {
  const view = decidePresence({
    ...ON,
    payload: payload([signal()]),
    unreachable: true,
    stale: true,
  });
  assert.equal(view.render && view.kind, "signals");
  if (view.render && view.kind === "signals") {
    assert.equal(view.stale, true, "stale data must be labelled, not hidden");
    assert.equal(view.signals.length, 1);
  }
});

test("stale cache holding zero signals still renders nothing", () => {
  const view = decidePresence({ ...ON, payload: payload([]), unreachable: true, stale: true });
  assert.deepEqual(view, { render: false });
});

// ── tolerating an evolving producer (§8.2) ──────────────────────────────────
test("unknown fields are ignored, malformed signals are dropped, page survives", () => {
  const raw = {
    signals: [
      { key: "ssl", severity: "critical", text: "SSL expires", future_field: "ignored" },
      { key: "junk", severity: "apocalyptic", text: "nope" },
      { key: "no-text", severity: "warn" },
      null,
      "string",
    ],
  };
  const out = normalize(raw);
  assert.deepEqual(out.map((s) => s.key), ["ssl"]);
  assert.equal(out[0].qualifier, null);
});

test("normalize never throws on garbage", () => {
  for (const junk of [null, undefined, {}, { signals: "no" }, { signals: 5 }, []]) {
    assert.deepEqual(normalize(junk), []);
  }
});

test("a non-relative deep link is refused (never signed into a handoff)", () => {
  const out = normalize({
    signals: [{ ...signal(), deep_link_path: "https://evil.example/steal" }],
  });
  assert.equal(out[0].deep_link_path, null);
});

// ── handoff links are minted server-side only ───────────────────────────────
test("handoff tokens are signed in server-only code, never in a component", () => {
  const lib = readFileSync("src/lib/linkspy/presence.ts", "utf8");
  assert.ok(lib.startsWith('import "server-only";'), "presence fetch must be server-only");
  assert.match(lib, /signHandoff\(/, "the server module mints the tokens");

  const component = readFileSync("src/components/qa/production-presence.tsx", "utf8");
  assert.doesNotMatch(component, /signHandoff|SPINE_SECRET|LINKSPY_API_KEY/,
    "the strip must receive pre-signed hrefs, never secrets");
  assert.doesNotMatch(component, /"use client"/,
    "the strip stays a server component — no secret ever reaches the browser");
});

test("the strip renders null for the hidden view (no empty wrapper in the DOM)", () => {
  const component = readFileSync("src/components/qa/production-presence.tsx", "utf8");
  assert.match(component, /if \(!view\.render\) return null;/);
});

// ── flag-off is byte-identical, proven by actually rendering ────────────────
test("flag off emits ZERO bytes of markup", async () => {
  const { renderToStaticMarkup } = await import("react-dom/server");
  const { ProductionPresence } = await import("@/components/qa/production-presence");

  const off = decidePresence({ ...ON, enabled: false, payload: payload([signal()]) });
  const html = renderToStaticMarkup(
    ProductionPresence({ view: off, hrefByKey: {} }) as React.ReactElement,
  );
  assert.equal(html, "", "flag off must contribute nothing to the DOM");
});

test("flag on with signals emits markup — so the empty case is a real result", async () => {
  const { renderToStaticMarkup } = await import("react-dom/server");
  const { ProductionPresence } = await import("@/components/qa/production-presence");

  const on = decidePresence({ ...ON, payload: payload([signal()]) });
  const html = renderToStaticMarkup(
    ProductionPresence({ view: on, hrefByKey: { ssl: "https://linkspy.example/handoff?token=t" } }) as React.ReactElement,
  );
  assert.match(html, /Production presence/);
  assert.match(html, /SSL certificate expires in 3 days/);
  assert.match(html, /monitoring holding/);
  assert.match(html, /https:\/\/linkspy\.example\/handoff\?token=t/);
  assert.ok(html.length > 0);
});

test("every rendered state: hidden, 1 signal, 3 signals, stale, unavailable", async () => {
  const { renderToStaticMarkup } = await import("react-dom/server");
  const { ProductionPresence } = await import("@/components/qa/production-presence");
  const render = (view: ReturnType<typeof decidePresence>, hrefs: Record<string, string> = {}) =>
    renderToStaticMarkup(ProductionPresence({ view, hrefByKey: hrefs }) as React.ReactElement);

  // hidden — healthy site
  assert.equal(render(decidePresence({ ...ON, payload: payload([]) })), "");

  // three signals — three lines, purple band, no "all good" wording
  const three = render(
    decidePresence({
      ...ON,
      payload: payload([
        signal({ key: "incident", text: "1 open incident", qualifier: "disaster sentinel" }),
        signal({ key: "index", text: "Search visibility at risk" }),
        signal({ key: "domain", severity: "warn", text: "Domain registration expires in 9 days" }),
      ]),
    }),
  );
  assert.equal((three.match(/lucide-triangle-alert/g) ?? []).length, 3, "one icon per signal");
  assert.match(three, /brand-purple/, "the strip reads as the federation's purple");
  assert.doesNotMatch(three, /all good|all clear|healthy/i);

  // stale — labelled "last seen", data still shown
  const stale = render(
    decidePresence({ ...ON, payload: payload([signal()]), unreachable: true, stale: true }),
  );
  assert.match(stale, /last seen/);
  assert.match(stale, /SSL certificate expires in 3 days/, "stale data is shown, not withheld");

  // unavailable — one muted line, no alarm
  const unavailable = render(decidePresence({ ...ON, payload: null, unreachable: true }));
  assert.match(unavailable, /Production status unavailable/);
  assert.doesNotMatch(unavailable, /text-error/, "not knowing is not an error state");
});

// ── the presence fetch must never block or throw ────────────────────────────
test("the fetch is timeout-bounded, cached 60s, and swallows every error", () => {
  const lib = readFileSync("src/lib/linkspy/presence.ts", "utf8");
  assert.match(lib, /AbortSignal\.timeout\(/, "a hung LinkSpy must not hang the QA page");
  assert.match(lib, /CACHE_MS = 60 \* 1000/, "60s cache per the presence contract");
  assert.match(lib, /catch\s*{\s*\n?\s*return null/, "network errors resolve, never throw");
});

// ── T4: presence is READ-ONLY ───────────────────────────────────────────────
test("no presence file writes anything to the database", () => {
  for (const f of [
    "src/lib/linkspy/presence.ts",
    "src/lib/linkspy/presence-shape.ts",
    "src/components/qa/production-presence.tsx",
  ]) {
    const src = readFileSync(f, "utf8");
    assert.doesNotMatch(src, /db\.|prisma|\.update\(|\.create\(|\.upsert\(|\.delete\(/,
      `${f} must stay read-only — presence state is derived, never stored`);
  }
});

// ── PII floor on the outbound bridge (Part B producer) ──────────────────────
test("only a first name ever crosses the delivery bridge", () => {
  assert.equal(firstName("Anaum Sheikh"), "Anaum");
  assert.equal(firstName("  Babar   Ali Khan "), "Babar");
  assert.equal(firstName("Cher"), "Cher");
  assert.equal(firstName(""), null);
  assert.equal(firstName("   "), null);
  assert.equal(firstName(null), null);
  assert.equal(firstName(undefined), null);
});

test("the delivery bridge selects no email or member id, and never writes", () => {
  const src = readFileSync("src/app/api/registry-bridge/delivery/route.ts", "utf8");
  assert.match(src, /tester: \{ select: \{ name: true \} \}/, "name only — no id, no email");
  // Code shapes, not prose: the word "email" is allowed in a comment saying
  // emails are forbidden; selecting or emitting one is not.
  assert.doesNotMatch(src, /email:\s*true|\.email\b|email:\s*page\./i,
    "emails must never be selected or emitted by the bridge");
  assert.doesNotMatch(src, /testerId|tester\.id/, "member ids stay in this app");
  assert.doesNotMatch(src, /\.update\(|\.create\(|\.upsert\(|\.delete\(/,
    "the delivery bridge is a read API");
});
