import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DEVICE_RULES, VIEWPORT_FINDINGS, explain } from "@/lib/layout-checks/explain";

/** The rule list, read from the tool rather than copied — so it cannot drift. */
function toolRules(): string[] {
  const src = readFileSync(resolve(process.cwd(), "../../services/devicepreview/devicepreview.py"), "utf8");
  const block = src.match(/DEFAULT_RULES: dict\[str, bool\] = \{([\s\S]*?)\}/);
  assert.ok(block, "DEFAULT_RULES not found — has the tool moved?");
  return [...block[1].matchAll(/"([a-z-]+)":/g)].map((m) => m[1]);
}

/** The ids the responsive engine builds findings with. */
function engineFindingIds(): string[] {
  const src = readFileSync(resolve(process.cwd(), "../../services/linkspy-api/responsive_engine.py"), "utf8");
  return [...new Set([...src.matchAll(/\bF_?\("([a-z-]+)"/g)].map((m) => m[1]))];
}

test("every device rule the tool can emit has an explanation", () => {
  const rules = toolRules();
  assert.ok(rules.length >= 12, `expected the full rule set, got ${rules.length}`);
  for (const r of rules) {
    assert.ok(DEVICE_RULES[r], `rule "${r}" has no explanation — a reader would get a bare measurement`);
  }
});

test("every viewport finding the engine can emit has an explanation", () => {
  for (const id of engineFindingIds()) {
    assert.ok(VIEWPORT_FINDINGS[id], `finding "${id}" has no explanation`);
  }
});

test("no explanation is left behind for a rule that no longer exists", () => {
  const known = new Set(toolRules());
  for (const key of Object.keys(DEVICE_RULES)) {
    assert.ok(known.has(key), `"${key}" is explained but the tool no longer emits it`);
  }
});

test("each explanation says what it is and what it costs the visitor", () => {
  for (const [key, e] of Object.entries({ ...DEVICE_RULES, ...VIEWPORT_FINDINGS })) {
    assert.ok(e.what.length > 25, `${key}: "what" is too thin to help`);
    assert.ok(e.why.length > 40, `${key}: "why" is too thin to help`);
    assert.ok(e.what.trim().endsWith("."), `${key}: "what" should read as a sentence`);
    assert.ok(e.why.trim().endsWith("."), `${key}: "why" should read as a sentence`);
    if (e.fix) assert.ok(e.fix.length > 25, `${key}: "fix" is too thin to help`);
  }
});

test("lookup is by kind, and an unknown id is null rather than a guess", () => {
  assert.equal(explain("device", "cls")?.what.includes("Cumulative Layout Shift"), true);
  assert.equal(explain("viewport", "cta")?.why.includes("landing page"), true);
  assert.equal(explain("device", "nope"), null);
  assert.equal(explain("viewport", "tap-small"), null, "device rules are not viewport findings");
});

test("the two tabs agree where they check the same thing", () => {
  assert.equal(VIEWPORT_FINDINGS.overflow, DEVICE_RULES.overflow, "one explanation, not two that drift");
  assert.equal(VIEWPORT_FINDINGS.clipped, DEVICE_RULES["clipped-text"]);
});
