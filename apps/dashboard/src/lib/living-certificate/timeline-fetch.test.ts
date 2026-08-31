import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  timelineUrl,
  readLedger,
  serveTimeline,
  isFresh,
  TIMELINE_LIMIT,
  TIMELINE_CACHE_MS,
} from "./timeline-source";

// Section 2's policy is tested by import; the server-only shell around it is
// tested by grep, because `server-only` does not resolve outside Next's bundler
// and no test in this repo imports such a module directly.

const LEDGER = [
  {
    id: "evt_2",
    type: "qa.completed",
    occurred_at: "2026-07-28T09:00:00.000Z",
    payload: { checklist_summary: { passed: 38 }, qa_page_ref: "pg_secret" },
  },
  {
    id: "evt_1",
    type: "deliverable.ready_for_qa",
    occurred_at: "2026-07-20T09:00:00.000Z",
    payload: { qa_page_ref: "pg_secret", url: "https://internal.example/admin" },
  },
];

// ═══ THE URL ═══
test("addresses the timeline endpoint with the deliverable id and a capped limit", () => {
  const u = new URL(timelineUrl("https://linkspy.example", "del_1"));
  assert.equal(u.pathname, "/api/registry-bridge/timeline");
  assert.equal(u.searchParams.get("registry_deliverable_id"), "del_1");
  assert.equal(u.searchParams.get("limit"), String(TIMELINE_LIMIT));
});

test("the deliverable id is encoded, and a trailing slash never doubles", () => {
  const u = new URL(timelineUrl("https://linkspy.example/", "del abc/1"));
  assert.equal(u.searchParams.get("registry_deliverable_id"), "del abc/1");
  assert.ok(!u.pathname.includes("//"), "no double slash");
});

// ═══ READING THE BODY ═══
test("reads the events array", () => {
  assert.equal(readLedger({ events: LEDGER })?.length, 2);
  assert.deepEqual(readLedger({ events: [] }), [], "an empty ledger is [], not null");
});

// A body we cannot read is a FAILED LOOK, not an empty history.
test("an unreadable body is null, never an empty timeline", () => {
  for (const body of [null, undefined, "text", 42, {}, { events: "nope" }, { events: null }]) {
    assert.equal(readLedger(body), null, `${JSON.stringify(body)} must read as null`);
  }
});

// ═══ null VS [] — THE DISTINCTION THE RENDERER DEPENDS ON ═══
test("a successful fetch is whitelisted and stored", () => {
  const { events, store } = serveTimeline(undefined, LEDGER);
  assert.equal(events?.length, 2);
  assert.equal(store, true);
  assert.deepEqual(events?.map((e) => e.kind), ["signed_off", "handed_to_qa"]);
  assert.equal(events?.[0].detail, "38 checks passed");
});

test("a successful EMPTY fetch stays [] — registered, nothing recorded yet", () => {
  const { events, store } = serveTimeline(undefined, []);
  assert.deepEqual(events, []);
  assert.equal(store, true);
});

test("a failed fetch with no cache is null — there is no section", () => {
  const { events, store } = serveTimeline(undefined, null);
  assert.equal(events, null);
  assert.equal(store, false, "a failure must never overwrite the cache");
});

// ═══ STALENESS OVER ERRORS ═══
test("a failed fetch serves the last known good", () => {
  const memo = { events: [{ at: "2026-07-28T09:00:00.000Z", kind: "signed_off" as const, title: "t", detail: null }], at: 0 };
  const { events, store } = serveTimeline(memo, null);
  assert.equal(events?.length, 1, "must serve last-known-good, not null");
  assert.equal(store, false);
});

// A previously-empty ledger is still a real answer and must survive a failure.
test("a failed fetch after an empty success serves [] again, not null", () => {
  const { events } = serveTimeline({ events: [], at: 0 }, null);
  assert.deepEqual(events, [], "an empty history is remembered, not forgotten");
});

// ═══ DENY BY DEFAULT, AT THIS LAYER TOO ═══
test("no internal id or url survives", () => {
  const json = JSON.stringify(serveTimeline(undefined, LEDGER).events);
  assert.doesNotMatch(json, /pg_secret/, "internal page refs must not cross");
  assert.doesNotMatch(json, /internal\.example/, "internal urls must not cross");
  assert.doesNotMatch(json, /evt_1|evt_2/, "ledger ids must not cross");
});

test("an unknown event type is dropped", () => {
  const { events } = serveTimeline(undefined, [
    { type: "spine.heartbeat", occurred_at: "2026-07-28T09:00:00Z" },
  ]);
  assert.deepEqual(events, []);
});

test("garbage rows never throw", () => {
  assert.doesNotThrow(() => serveTimeline(undefined, [null, 1, {}] as never));
});

// ═══ CACHE WINDOW ═══
test("freshness respects the 60 second window", () => {
  const memo = { events: [], at: 1_000_000 };
  assert.equal(isFresh(memo, 1_000_000 + 59_000), true);
  assert.equal(isFresh(memo, 1_000_000 + TIMELINE_CACHE_MS), false, "expiry is exclusive");
  assert.equal(isFresh(undefined, 1_000_000), false, "no memo is never fresh");
});

// ═══ THE SERVER-ONLY SHELL (grep) ═══
const shell = readFileSync(
  resolve(process.cwd(), "src/lib/living-certificate/timeline-fetch.ts"),
  "utf8",
);

test("the shell is server-only and touches no database", () => {
  assert.match(shell, /^import "server-only";/m, "the service key must never reach a bundle");
  assert.doesNotMatch(shell, /@\/lib\/db|\bdb\./, "Section 2 must not touch the database at all");
});

test("the shell issues no request without a deliverable id or configuration", () => {
  assert.match(
    shell,
    /if \(!deliverableId \|\| !configured\(\)\) return null;/,
    "an unannotated page must short-circuit before any fetch",
  );
});

test("a non-ok response is treated as a failed look, not an empty one", () => {
  assert.match(shell, /if \(!res\.ok\) return null;/);
});

test("the key is sent as a bearer header, never in the url", () => {
  assert.match(shell, /Authorization: `Bearer \$\{process\.env\.LINKSPY_API_KEY/);
  assert.doesNotMatch(
    shell.replace(/^import[\s\S]*?;$/m, ""),
    /timelineUrl\([^)]*LINKSPY_API_KEY/,
    "the key must never be built into the url",
  );
});
