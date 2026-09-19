import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { DEFAULT_ROLES, OWNER_LABEL, SURFACE_LABEL, roleOf } from "./check-roles";

// Who fixes what, agreed with the operator on 2026-09-19. These assertions are
// the record of that agreement — a change here is a change to how the team
// divides work, not a refactor.

test("the client owns their DNS and nothing else", () => {
  const client = Object.entries(DEFAULT_ROLES)
    .filter(([, r]) => r.owner === "client")
    .map(([k]) => k)
    .sort();
  assert.deepEqual(client, ["dkim", "dmarc", "mx", "spf"]);
  for (const k of client) assert.equal(DEFAULT_ROLES[k].surface, "infrastructure");
});

test("content owns the words somebody chooses, and only those", () => {
  const content = Object.entries(DEFAULT_ROLES)
    .filter(([, r]) => r.owner === "content")
    .map(([k]) => k)
    .sort();
  assert.deepEqual(content, ["description", "og", "title"]);
});

test("alt text is a developer's, against the obvious instinct", () => {
  // It is missing because the component does not pass the attribute through,
  // not because nobody wrote a description. A copywriter handed "add alt text"
  // has nowhere to put it.
  assert.equal(DEFAULT_ROLES["alt"].owner, "developer");
  assert.equal(DEFAULT_ROLES["h1"].owner, "developer");
  assert.equal(DEFAULT_ROLES["headings"].owner, "developer");
});

test("surface says where the fix lives, not where the fault is on screen", () => {
  assert.equal(DEFAULT_ROLES["labels"].surface, "page");
  assert.equal(DEFAULT_ROLES["hsts"].surface, "infrastructure");
  assert.equal(DEFAULT_ROLES["sitemap"].surface, "infrastructure", "a root file, not the page");
  assert.equal(DEFAULT_ROLES["noindex"].surface, "page", "usually a meta tag");
  // The label must not claim a location we cannot point to — no check records
  // a selector (#170).
  assert.match(SURFACE_LABEL.page, /markup/);
  assert.ok(!/where|position|on the page at/i.test(SURFACE_LABEL.page));
});

test("an unknown key gets no role rather than a guessed one", () => {
  assert.equal(roleOf("a-check-nobody-has-written"), null);
  assert.equal(roleOf(""), null);
  assert.equal(roleOf(null), null);
  assert.equal(roleOf(undefined), null);
});

test("overrides are the seam for per-client arrangements", () => {
  // Nothing passes these yet. The shape exists so a client table can arrive
  // without touching a single call site.
  assert.deepEqual(roleOf("description", { description: { owner: "developer" } }),
    { owner: "developer", surface: "page" });
  assert.deepEqual(roleOf("hsts", { hsts: { surface: "page" } }),
    { owner: "developer", surface: "page" });
  // An override for a key with no default still yields a complete role.
  assert.deepEqual(roleOf("brand-new", { "brand-new": { owner: "content" } }),
    { owner: "content", surface: "page" });
});

test("every owner and surface has a label a reader can read", () => {
  for (const r of Object.values(DEFAULT_ROLES)) {
    assert.ok(OWNER_LABEL[r.owner], r.owner);
    assert.ok(SURFACE_LABEL[r.surface], r.surface);
  }
});

// ── the ratchet ─────────────────────────────────────────────────────────────

test("every check key the backend can emit has an agreed owner", () => {
  // Reads the Python the guards are written in. If the sibling service is not
  // checked out this skips rather than failing a Dashboard-only build — but
  // where it IS present, a new check with no agreed owner fails here rather
  // than appearing on the Overview with a blank label.
  const api = join(process.cwd(), "..", "..", "services", "linkspy-api");
  if (!existsSync(api)) return;

  const keys = new Set<string>();
  const guards = readFileSync(join(api, "sentinel_guards.py"), "utf8");
  for (const m of guards.matchAll(/"key":\s*"([a-z0-9_]+)"/g)) keys.add(m[1]);
  const sentinel = readFileSync(join(api, "sentinel.py"), "utf8");
  for (const m of sentinel.matchAll(/\badd\("([a-z0-9_]+)"/g)) keys.add(m[1]);

  assert.ok(keys.size > 20, `expected the full key list, found ${keys.size}`);
  const unowned = [...keys].filter((k) => !DEFAULT_ROLES[k]).sort();
  assert.deepEqual(unowned, [],
    "These checks have no agreed owner. Add them to DEFAULT_ROLES — and if the " +
    "answer is arguable, ask rather than guessing.");
});
