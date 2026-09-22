import test from "node:test";
import assert from "node:assert/strict";

import { MEMBER_ROLES } from "./constants";
import { buildsPages, doesPageWork, testsPages } from "./roles";

// One explicit row per role. A role added to MEMBER_ROLES and not to this table
// fails the last test in this file, which is the point: the last two times a
// role was added, it was quietly swept into the developer lists by a `!==`.
const TABLE: Record<string, { builds: boolean; tests: boolean }> = {
  DEVELOPER: { builds: true, tests: false },
  TESTER: { builds: false, tests: true },
  BOTH: { builds: true, tests: true },
  MANAGER: { builds: false, tests: false },
};

test("each role builds and tests exactly what it says it does", () => {
  for (const [role, want] of Object.entries(TABLE)) {
    assert.equal(buildsPages(role), want.builds, `${role} builds`);
    assert.equal(testsPages(role), want.tests, `${role} tests`);
    assert.equal(doesPageWork(role), want.builds || want.tests, `${role} does page work`);
  }
});

test("a manager is on the team and in none of the work lists", () => {
  assert.equal(doesPageWork("MANAGER"), false);
  // The blacklist this replaces — `role !== "TESTER"` standing in for
  // "developers" — answered yes for exactly this role. That is the bug.
  const blacklist = (role: string) => role !== "TESTER";
  assert.equal(blacklist("MANAGER"), true, "the old form called a manager a developer");
  assert.equal(buildsPages("MANAGER"), false, "the whitelist does not");
});

test("an unknown role does no page work rather than all of it", () => {
  assert.equal(buildsPages("ACCOUNTANT"), false);
  assert.equal(testsPages(""), false);
  assert.equal(doesPageWork("developer"), false, "case matters; the stored value is upper");
});

test("every role in MEMBER_ROLES has been decided on", () => {
  for (const role of MEMBER_ROLES) {
    assert.ok(role in TABLE, `${role} is missing from this file's table — decide what it does`);
  }
});
