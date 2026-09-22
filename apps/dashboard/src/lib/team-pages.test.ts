import test from "node:test";
import assert from "node:assert/strict";

import { groupByClient, groupSummary } from "./team-pages";

const pg = (client: string, name: string, issues = 0) => ({
  id: name,
  name,
  project: { clientId: client.toLowerCase(), client: { name: client } },
  issues: Array.from({ length: issues }, () => ({ severity: "LOW" })),
});

test("pages land under their client, with the issues added up", () => {
  const groups = groupByClient([
    pg("Savvio", "Home", 10),
    pg("WBI", "Competitor", 12),
    pg("Savvio", "Checkout", 5),
    pg("Savvio", "Thank you", 5),
  ]);
  assert.deepEqual(groups.map((g) => [g.client, g.pages.length, g.issues]), [
    ["Savvio", 3, 20],
    ["WBI", 1, 12],
  ]);
  // The pages keep the order they arrived in — the caller already sorted them.
  assert.deepEqual(groups[0].pages.map((p) => p.name), ["Home", "Checkout", "Thank you"]);
});

test("the biggest client is first, and ties never jitter", () => {
  const groups = groupByClient([pg("Zeta", "a"), pg("Alpha", "b"), pg("Mid", "c"), pg("Mid", "d")]);
  assert.deepEqual(groups.map((g) => g.client), ["Mid", "Alpha", "Zeta"]);
});

test("two clients that share a name are still two clients", () => {
  // Grouping is by id, not by the name printed on screen.
  const a = { ...pg("Acme", "one"), project: { clientId: "c1", client: { name: "Acme" } } };
  const b = { ...pg("Acme", "two"), project: { clientId: "c2", client: { name: "Acme" } } };
  assert.equal(groupByClient([a, b]).length, 2);
});

test("no pages, no groups", () => {
  assert.deepEqual(groupByClient([]), []);
});

test("the summary line reads as a sentence at every count", () => {
  assert.equal(groupSummary(12, 47), "12 pages · 47 issues");
  assert.equal(groupSummary(1, 1), "1 page · 1 issue");
  assert.equal(groupSummary(1, 0), "1 page · no issues");
  assert.equal(groupSummary(3, 0), "3 pages · no issues");
});
