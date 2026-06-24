import { test } from "node:test";
import assert from "node:assert/strict";
import { buildAttention, type AttentionInput } from "./attention";

function page(over: Partial<AttentionInput> = {}): AttentionInput {
  return {
    id: "p1",
    name: "Page",
    status: "IN_PROGRESS",
    delayDays: 0,
    hasDeveloper: true,
    hasTester: true,
    certStatus: "PASS",
    items: [{ result: "PASSED" }],
    issues: [],
    clientId: "c1",
    clientName: "Acme",
    projectId: "pr1",
    ...over,
  };
}

test("a healthy, signed-off page raises no flags", () => {
  const r = buildAttention([page()]);
  assert.equal(r.total, 0);
  assert.deepEqual(r.items, []);
});

test("live without QA sign-off is the top flag", () => {
  const r = buildAttention([page({ status: "LIVE", certStatus: "IN_PROGRESS", items: [] })]);
  assert.equal(r.total, 1);
  assert.equal(r.items[0].reasons[0].kind, "LIVE_NO_SIGNOFF");
  assert.equal(r.items[0].weight, 100);
});

test("open critical issues are flagged with a count", () => {
  const r = buildAttention([
    page({
      issues: [
        { severity: "CRITICAL_HIGH", status: "OPEN" },
        { severity: "CRITICAL_HIGH", status: "OPEN" },
        { severity: "CRITICAL_HIGH", status: "FIXED" },
      ],
    }),
  ]);
  const reason = r.items[0].reasons.find((x) => x.kind === "OPEN_CRITICAL");
  assert.ok(reason);
  assert.match(reason!.label, /2 critical issues open/);
});

test("lateness only flags past the threshold", () => {
  assert.equal(buildAttention([page({ delayDays: 3 })]).total, 0);
  const late = buildAttention([page({ delayDays: 7 })]);
  assert.equal(late.items[0].reasons[0].kind, "LATE");
});

test("a page can collect multiple ranked reasons, most urgent first", () => {
  const r = buildAttention([
    page({
      status: "LIVE",
      certStatus: "IN_PROGRESS",
      delayDays: 10,
      hasTester: false,
      items: [],
      issues: [{ severity: "CRITICAL_HIGH", status: "OPEN" }],
    }),
  ]);
  const kinds = r.items[0].reasons.map((x) => x.kind);
  assert.deepEqual(kinds[0], "LIVE_NO_SIGNOFF"); // highest weight leads
  assert.ok(kinds.includes("OPEN_CRITICAL"));
  assert.ok(kinds.includes("LATE"));
  assert.ok(kinds.includes("UNASSIGNED"));
});

test("items are sorted by urgency, then by number of problems", () => {
  const mild = page({ id: "mild", delayDays: 6 }); // one warning
  const severe = page({ id: "severe", status: "LIVE", certStatus: "FAIL", items: [] }); // top weight
  const r = buildAttention([mild, severe]);
  assert.equal(r.items[0].id, "severe");
  assert.equal(r.items[1].id, "mild");
});

test("byKind tallies how many pages hit each signal", () => {
  const r = buildAttention([
    page({ id: "a", delayDays: 9 }),
    page({ id: "b", delayDays: 9 }),
    page({ id: "c", hasDeveloper: false }),
  ]);
  assert.equal(r.byKind.LATE, 2);
  assert.equal(r.byKind.UNASSIGNED, 1);
});
