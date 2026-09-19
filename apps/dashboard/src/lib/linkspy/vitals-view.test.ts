import test from "node:test";
import assert from "node:assert/strict";

import type { VitalCard } from "./sites-view";
import {
  badChecks, cardSummary, overviewVerdict, partitionCards, remedyFor, sortBySeverity,
} from "./vitals-view";

const card = (over: Partial<VitalCard> & { key: string }): VitalCard => ({
  label: over.key.toUpperCase(), escalation: "ok", fact: "All clear", ...over,
});

const NINE: VitalCard[] = [
  card({ key: "ssl", fact: "31 days" }),
  card({ key: "uptime", fact: "100%" }),
  card({ key: "seo", escalation: "notice", fact: "1 to look at",
        checks: [{ status: "notice", text: "Meta description: 200 characters — long" }] }),
  card({ key: "email", label: "Email", escalation: "critical", fact: "2 to fix",
        checks: [{ status: "critical", text: "SPF: none" },
                 { status: "notice", text: "DMARC: p=none (monitoring only)" }] }),
  card({ key: "security", escalation: "warn", fact: "2 to fix",
        checks: [{ status: "warn", text: "HSTS: missing" },
                 { status: "warn", text: "CSP: missing" }] }),
  card({ key: "domain", fact: "309 days" }),
  card({ key: "dns", fact: "Steady" }),
  card({ key: "a11y", escalation: "warn", fact: "1 to fix",
        checks: [{ status: "warn", text: "Form fields: 2 of 5 without a label" }] }),
  card({ key: "index", fact: "Indexable" }),
];

test("severity decides the order, never the category or the name", () => {
  const order = sortBySeverity(NINE).map((c) => c.escalation);
  assert.deepEqual(order, ["critical", "warn", "warn", "notice", "ok", "ok", "ok", "ok", "ok"]);
});

test("passing checks collapse; anything unproven does not", () => {
  const { attention, passing } = partitionCards([
    ...NINE, card({ key: "tracking", escalation: "unknown", fact: "unavailable" }),
  ]);
  assert.equal(passing.length, 5, "five green checks collapse into the strip");
  assert.ok(attention.some((c) => c.escalation === "unknown"),
    "'we could not check this' is not a pass and must stay visible");
  assert.equal(attention[0].escalation, "critical", "worst first");
});

test("the verdict counts, then names the one worth acting on", () => {
  const v = overviewVerdict(NINE);
  assert.equal(v.headline, "1 critical · 2 warnings across 9 checks");
  assert.equal(v.tone, "error");
  assert.match(v.urgent ?? "", /^Email is the urgent one: SPF: none/,
    "an acronym keeps its case");
  assert.match(v.urgent ?? "", /Publish an SPF record/, "it carries the remedy");
});

test("all clear says so and says nothing else", () => {
  const v = overviewVerdict(NINE.filter((c) => c.escalation === "ok"));
  assert.equal(v.headline, "All 5 checks passing");
  assert.equal(v.tone, "success");
  assert.equal(v.urgent, null);
});

test("a warnings-only site is amber, not red", () => {
  const v = overviewVerdict(NINE.filter((c) => c.escalation !== "critical"));
  assert.equal(v.tone, "warning");
  assert.match(v.headline, /^2 warnings across 8 checks$/);
});

test("unknown checks are counted honestly rather than as passes", () => {
  const v = overviewVerdict([card({ key: "a" }), card({ key: "b", escalation: "unknown", fact: "unavailable" })]);
  assert.match(v.headline, /1 not established across 2 checks/);
  assert.notEqual(v.tone, "success");
});

test("the summary gives a count and the worst one whole — never half a sentence", () => {
  const email = NINE.find((c) => c.key === "email")!;
  const { count, worst } = cardSummary(email);
  assert.equal(count, 2);
  assert.equal(worst, "SPF: none", "the worst one in full, not truncated");
  assert.equal(badChecks(email)[0].status, "critical", "worst first inside the card too");
});

test("a passing card has nothing to summarise", () => {
  assert.deepEqual(cardSummary(card({ key: "ssl", fact: "31 days" })), { count: 0, worst: null });
});

test("remedies are one plain sentence, and absent rather than guessed", () => {
  assert.match(remedyFor("SPF: 2 records")!, /Merge them into a single record/);
  assert.match(remedyFor("HSTS: missing")!, /Strict-Transport-Security/);
  assert.match(remedyFor("Form fields: 1 of 5 without a label")!, /aria-label/);
  assert.match(remedyFor("Meta description: 195 characters — long")!, /155/);
  assert.match(remedyFor("Homepage carries a noindex directive")!, /Remove the noindex/);
  assert.equal(remedyFor("Something nobody has written a remedy for"), null);
  assert.equal(remedyFor(""), null);
});

test("a sentence-cased finding does get lower-cased into the line", () => {
  const v = overviewVerdict([card({ key: "index", label: "Search visibility", escalation: "critical",
    fact: "At risk", checks: [{ status: "critical", text: "Homepage carries a noindex directive" }] })]);
  assert.match(v.urgent ?? "", /: homepage carries a noindex/);
});

test("an empty payload never claims everything passes", () => {
  const v = overviewVerdict([]);
  assert.notEqual(v.tone, "success");
  assert.match(v.headline, /No checks/);
});

// ── the findings list ───────────────────────────────────────────────────────

test("every finding across every card, worst first", () => {
  const { findingsOf } = require("./vitals-view");
  const list = findingsOf(NINE);
  assert.deepEqual(list.map((f: { status: string }) => f.status),
    ["critical", "warn", "warn", "warn", "notice", "notice"]);
  assert.equal(list[0].text, "SPF: none");
  assert.equal(list[0].cardLabel, "Email", "the card it came from survives as context");
  assert.match(list[0].remedy, /Publish an SPF record/);
});

test("the header counts work, not checks", () => {
  const { workCount } = require("./vitals-view");
  assert.equal(workCount(NINE), 6, "six findings across nine checks");
  assert.equal(workCount(NINE.filter((c) => c.escalation === "ok")), 0);
});

test("findings have ids stable enough to key a list", () => {
  const { findingsOf } = require("./vitals-view");
  const ids = findingsOf(NINE).map((f: { id: string }) => f.id);
  assert.equal(new Set(ids).size, ids.length, "no duplicates");
  assert.ok(ids.every((id: string) => id.includes(":")));
});

test("the passing line reads as a sentence, however many there are", () => {
  const { passingLine } = require("./vitals-view");
  const named = (labels: string[]) =>
    labels.map((l, i) => card({ key: `k${i}`, label: l, fact: "fine" }));
  assert.equal(passingLine(named(["SSL", "Domain", "Uptime", "DNS"])),
    "SSL, domain, uptime and DNS are all fine", "acronyms keep their case");
  assert.equal(passingLine(named(["Domain"])), "Domain is all fine");
  assert.equal(passingLine(named(["SSL"])), "SSL is all fine");
  assert.equal(passingLine([]), null, "nothing passing means no line at all");
});

test("unknown is never folded in with passing", () => {
  const { passingLine, unknownCards, findingsOf } = require("./vitals-view");
  const cards = [card({ key: "ssl", fact: "31 days" }),
                 card({ key: "tracking", label: "Tracking", escalation: "unknown", fact: "unavailable" })];
  assert.equal(unknownCards(cards).length, 1);
  assert.ok(!(passingLine(cards) ?? "").includes("tracking"));
  assert.equal(findingsOf(cards).length, 0, "and it is not work either — it is unproven");
});
