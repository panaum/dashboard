import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  toClientTimeline,
  CLIENT_VISIBLE_TYPES,
  type LedgerEvent,
} from "./timeline-shape";

// ═══ LIVING CERTIFICATE — the client-facing whitelist ════════════════════════
// The load-bearing property: DENY BY DEFAULT. Anything not explicitly allowed
// must never reach a client's browser, including event types invented later.

const AT = "2026-08-10T09:00:00.000Z";

function ledger(over: Partial<LedgerEvent> = {}): LedgerEvent {
  return {
    id: "11111111-2222-3333-4444-555555555555",
    registry_site_id: "site-secret",
    registry_deliverable_id: "deliv-secret",
    type: "qa.completed",
    payload: { qa_page_ref: "cm4internal9page", checklist_summary: { passed: 38, failed: 0, na: 2 } },
    occurred_at: AT,
    source: "spine",
    ...over,
  };
}

// ── deny by default ─────────────────────────────────────────────────────────
test("an unknown event type is dropped entirely", () => {
  assert.deepEqual(toClientTimeline([ledger({ type: "some.future.event" })]), []);
});

test("a future spine event cannot leak to a client without a human decision", () => {
  const invented = [
    ledger({ type: "deliverable.live_observed" }),
    ledger({ type: "incident.gap_analysis" }),
    ledger({ type: "billing.invoice_raised" }),
    ledger({ type: "" }),
    ledger({ type: undefined }),
  ];
  assert.deepEqual(toClientTimeline(invented), [], "deny by default is the whole point");
});

test("internal process events are excluded on purpose", () => {
  for (const t of ["heartbeat", "checklist.candidate_created", "checklist.item_promoted"]) {
    assert.deepEqual(toClientTimeline([ledger({ type: t })]), [],
      `${t} is about how we work, not about the client's site`);
    assert.ok(!CLIENT_VISIBLE_TYPES.includes(t));
  }
});

test("the visible set is exactly two types, and both are about their site", () => {
  assert.deepEqual(CLIENT_VISIBLE_TYPES.sort(), ["deliverable.ready_for_qa", "qa.completed"]);
});

// ── no identifiers ever cross ───────────────────────────────────────────────
test("no id, ref, or internal key survives the whitelist", () => {
  const out = toClientTimeline([ledger(), ledger({ type: "deliverable.ready_for_qa" })]);
  const flat = JSON.stringify(out);
  for (const secret of [
    "11111111-2222-3333-4444-555555555555", // row id
    "site-secret",                          // registry_site_id
    "deliv-secret",                         // registry_deliverable_id
    "cm4internal9page",                     // qa_page_ref — our primary key
    "spine",                                // source
  ]) {
    assert.ok(!flat.includes(secret), `${secret} must never reach a client`);
  }
});

test("the emitted shape has exactly four fields", () => {
  const [e] = toClientTimeline([ledger()]);
  assert.deepEqual(Object.keys(e).sort(), ["at", "detail", "kind", "title"]);
});

test("payload is never spread — an unexpected key cannot ride along", () => {
  const out = toClientTimeline([
    ledger({ payload: { checklist_summary: { passed: 1 }, internal_note: "do not ship", url: "https://staging.internal/x" } }),
  ]);
  const flat = JSON.stringify(out);
  assert.ok(!flat.includes("do not ship"));
  assert.ok(!flat.includes("staging.internal"));
});

test("ready_for_qa carries no detail at all, so its url and page ref cannot leak", () => {
  const [e] = toClientTimeline([
    ledger({ type: "deliverable.ready_for_qa", payload: { qa_page_ref: "cm4x", url: "https://staging/x", name: "Home" } }),
  ]);
  assert.equal(e.detail, null);
  assert.equal(e.kind, "handed_to_qa");
});

// ── the one thing a client does see ─────────────────────────────────────────
test("sign-off reports the passed count as a sentence", () => {
  const [e] = toClientTimeline([ledger()]);
  assert.equal(e.kind, "signed_off");
  assert.equal(e.title, "Quality assurance signed off");
  assert.equal(e.detail, "38 checks passed");
  assert.equal(e.at, AT);
});

test("one passed check is singular", () => {
  const [e] = toClientTimeline([ledger({ payload: { checklist_summary: { passed: 1 } } })]);
  assert.equal(e.detail, "1 check passed");
});

test("a missing or malformed summary degrades to no detail, never to a crash", () => {
  for (const payload of [
    {}, null, { checklist_summary: null }, { checklist_summary: "38" },
    { checklist_summary: { passed: "many" } }, { checklist_summary: { passed: -1 } },
  ] as unknown as Record<string, unknown>[]) {
    const [e] = toClientTimeline([ledger({ payload })]);
    assert.equal(e.detail, null);
  }
});

// ── robustness: a client page must never 500 ────────────────────────────────
test("garbage input never throws", () => {
  for (const junk of [null, undefined, [], "no", 5, {}] as unknown as LedgerEvent[][]) {
    assert.deepEqual(toClientTimeline(junk), []);
  }
  assert.deepEqual(toClientTimeline([null, undefined, 5, "x"] as unknown as LedgerEvent[]), []);
});

test("an undated or invalid-dated row is dropped rather than rendered wrong", () => {
  assert.deepEqual(toClientTimeline([ledger({ occurred_at: undefined })]), []);
  assert.deepEqual(toClientTimeline([ledger({ occurred_at: "not-a-date" })]), []);
});

test("ordering from the ledger is preserved", () => {
  const out = toClientTimeline([
    ledger({ occurred_at: "2026-08-10T09:00:00.000Z" }),
    ledger({ type: "deliverable.ready_for_qa", occurred_at: "2026-06-01T09:00:00.000Z" }),
  ]);
  assert.deepEqual(out.map((e) => e.kind), ["signed_off", "handed_to_qa"]);
});

// ── the module stays pure and client-safe ───────────────────────────────────
test("the whitelist is pure — no I/O, no secrets, no db", () => {
  const src = readFileSync("src/lib/living-certificate/timeline-shape.ts", "utf8");
  for (const banned of ["process.env", "fetch(", "db.", "prisma", "server-only", "import "]) {
    if (banned === "import ") {
      // type-only imports are fine; runtime imports are not
      assert.ok(!/^import\s+(?!type)/m.test(src), "no runtime imports in the whitelist");
      continue;
    }
    assert.ok(!src.includes(banned), `whitelist must stay pure — found ${banned}`);
  }
});

test("the rule table never spreads payload", () => {
  const src = readFileSync("src/lib/living-certificate/timeline-shape.ts", "utf8");
  assert.ok(!/\.\.\.payload/.test(src), "spreading payload would defeat the whitelist");
  assert.ok(!/\.\.\.e\b/.test(src), "spreading the ledger row would leak ids");
});
