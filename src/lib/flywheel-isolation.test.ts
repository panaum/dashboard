import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { CONTRACT_CHECKSUM, EVENT_TYPES } from "./spine-contract";

function walk(dir: string, acc: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) { if (!p.includes("node_modules")) walk(p, acc); }
    else if (/\.(ts|tsx)$/.test(e) && !e.endsWith(".test.ts")) acc.push(p.replace(/\\/g, "/"));
  }
  return acc;
}

const CANDIDATES = "src/app/dashboard/checklists/candidates";
const actions = readFileSync(`${CANDIDATES}/actions.ts`, "utf8");
const inbox = readFileSync("src/app/api/spine/inbox/route.ts", "utf8");

// B4: the Dashboard contract mirrors LinkSpy exactly, with the flywheel events.
test("contract is v2 and carries the flywheel events", () => {
  assert.equal(CONTRACT_CHECKSUM, "36924adb1f215608a293759e8bbb78f88b37d17a4ac408ec5ef8b11d5fbab66b");
  assert.equal(EVENT_TYPES.CANDIDATE_CREATED, "checklist.candidate_created");
  assert.equal(EVENT_TYPES.ITEM_PROMOTED, "checklist.item_promoted");
});

// T4: NOTHING in the flywheel code writes an existing QA row (QACheckItem /
// QACertificate). Promotion writes ONLY ChecklistTemplateItem (new deliverables
// inherit it; existing pages' QACheckItems are never touched).
test("flywheel code never writes QACheckItem / QACertificate", () => {
  for (const src of [actions, inbox]) {
    assert.doesNotMatch(src, /qACheckItem\s*\.\s*(create|update|delete|updateMany|createMany|deleteMany)/i);
    assert.doesNotMatch(src, /qACertificate\s*\.\s*(create|update|delete)/i);
  }
  // the only template write in promote is ChecklistTemplateItem.create
  assert.match(actions, /checklistTemplateItem\.create/);
});

// promote rejects an empty rationale SERVER-SIDE (not just the UI).
test("promote enforces a non-empty rationale server-side", () => {
  assert.match(actions, /rationale[\s\S]*trim\(\)/);
  assert.match(actions, /if \(!rationale\) return \{ error/);
});

// dismiss writes status/reason only — never emits an event.
test("dismiss emits nothing", () => {
  const dismiss = actions.slice(actions.indexOf("export async function dismissCandidate"));
  assert.doesNotMatch(dismiss, /emitItemPromoted|spineOutbox/);
});

// inbox is idempotent by the LinkSpy candidate ref.
test("inbox is idempotent by linkspyCandidateRef", () => {
  assert.match(inbox, /findUnique\(\{ where: \{ linkspyCandidateRef/);
  assert.match(inbox, /duplicate: true/);
});

// no bridge/spine secret leaks into a client component.
test("SPINE_SECRET never in a client component", () => {
  for (const f of walk("src").filter((f) => /^"use client";/m.test(readFileSync(f, "utf8")))) {
    assert.doesNotMatch(readFileSync(f, "utf8"), /SPINE_SECRET/, `${f} leaks SPINE_SECRET`);
  }
});
