import test from "node:test";
import assert from "node:assert/strict";

import { MEMBER_ROLES } from "./constants";
import {
  compareManagement, DESIGNATIONS, designationFor, MANAGEMENT_ORDER, memberLabel, roleForDesignation,
} from "./designations";
import { buildsPages, doesPageWork, testsPages } from "./roles";

test("every designation maps to a real work role", () => {
  for (const d of DESIGNATIONS) {
    assert.ok((MEMBER_ROLES as readonly string[]).includes(d.role), `${d.title} -> ${d.role}`);
  }
});

test("each work role is reachable from at least one designation", () => {
  // Otherwise a role exists that nobody can be given through the only form
  // that sets it.
  for (const role of MEMBER_ROLES) {
    assert.ok(DESIGNATIONS.some((d) => d.role === role), `no designation produces ${role}`);
  }
});

test("the titles this team actually uses resolve the way they read", () => {
  assert.equal(roleForDesignation("CEO"), "MANAGER");
  assert.equal(roleForDesignation("Project Manager"), "MANAGER");
  assert.equal(roleForDesignation("Chief Delivery Officer"), "MANAGER");
  assert.equal(roleForDesignation("Head of Accounts"), "MANAGER");
  assert.equal(roleForDesignation("QA Lead"), "TESTER");
  assert.equal(roleForDesignation("Developer"), "DEVELOPER");
  assert.equal(roleForDesignation("Developer & QA"), "BOTH");
  // Which is the point: the CEO and the PM land outside every work list.
  assert.equal(doesPageWork(roleForDesignation("CEO")!), false);
  assert.equal(doesPageWork(roleForDesignation("Project Manager")!), false);
  assert.equal(buildsPages(roleForDesignation("Senior Developer")!), true);
  assert.equal(testsPages(roleForDesignation("QA")!), true);
});

test("a title we have never seen resolves to null, not to a guess", () => {
  assert.equal(roleForDesignation("Tech Lead"), null);
  assert.equal(roleForDesignation(""), null);
  assert.equal(roleForDesignation("   "), null);
  assert.equal(roleForDesignation(null), null);
  assert.equal(roleForDesignation(undefined), null);
  // Whitespace around a known one is still that one.
  assert.equal(roleForDesignation("  CEO "), "MANAGER");
  // Case is not normalised: "ceo" is a different string and we do not guess.
  assert.equal(roleForDesignation("ceo"), null);
});

test("one label under a name, never two", () => {
  assert.equal(memberLabel({ title: "CEO", role: "MANAGER" }), "CEO");
  // No designation set yet: fall back to the plain role rather than showing
  // nothing or showing both.
  assert.equal(memberLabel({ title: null, role: "DEVELOPER" }), "Developer");
  assert.equal(memberLabel({ title: "   ", role: "TESTER" }), "Tester");
  // A free-text title from before this change still shows, as typed.
  assert.equal(memberLabel({ title: "Tech Lead", role: "DEVELOPER" }), "Tech Lead");
});

test("the dialog opens on what they already are", () => {
  assert.equal(designationFor({ title: "QA Lead", role: "TESTER" }), "QA Lead");
  // No title yet: the first stock designation for the role they hold, so
  // opening and saving the dialog does not move them.
  assert.equal(designationFor({ title: null, role: "TESTER" }), "QA");
  assert.equal(designationFor({ title: null, role: "MANAGER" }), "Project Manager");
  assert.equal(designationFor({ title: null, role: "BOTH" }), "Developer & QA");
  assert.equal(roleForDesignation(designationFor({ title: null, role: "MANAGER" })), "MANAGER");
  // An unknown role cannot happen through the form, but must not crash a page.
  assert.equal(designationFor({ title: null, role: "ACCOUNTANT" }), "Developer");
});

// ── the management block's order ────────────────────────────────────────────

const mgr = (name: string, title: string) => ({ name, title, role: "MANAGER" });

test("the CEO reads first, then the rest in seniority order", () => {
  const people = [
    mgr("Afriyaz Maqbool", "Head of Accounts"),
    mgr("Sajad Sheikh", "Chief Delivery Officer"),
    mgr("Waseem Bashir", "CEO"),
  ];
  // Alphabetically this is exactly the wrong way round, which is the bug.
  assert.deepEqual(
    [...people].sort(compareManagement).map((m) => m.name),
    ["Waseem Bashir", "Sajad Sheikh", "Afriyaz Maqbool"],
  );
  // And it does not depend on the order they arrive in.
  assert.deepEqual(
    [...people].reverse().sort(compareManagement).map((m) => m.name),
    ["Waseem Bashir", "Sajad Sheikh", "Afriyaz Maqbool"],
  );
});

test("a title nobody ranked sorts after the ranked ones, by name", () => {
  const people = [
    mgr("Zara", "Office Manager"),
    mgr("Waseem Bashir", "CEO"),
    mgr("Adil", "Operations Lead"),
  ];
  assert.deepEqual(
    [...people].sort(compareManagement).map((m) => m.name),
    ["Waseem Bashir", "Adil", "Zara"],
  );
});

test("a manager with no title at all still sorts, on their plain role", () => {
  const people = [
    { name: "Nadia", title: null, role: "MANAGER" },
    mgr("Waseem Bashir", "CEO"),
  ];
  assert.deepEqual([...people].sort(compareManagement).map((m) => m.name), ["Waseem Bashir", "Nadia"]);
});

test("every ranked title is a real manager designation", () => {
  // Otherwise the order silently stops applying to somebody.
  for (const title of MANAGEMENT_ORDER) {
    const d = DESIGNATIONS.find((x) => x.title === title);
    assert.ok(d, `${title} is ranked but is not a designation`);
    assert.equal(d!.role, "MANAGER", `${title} is ranked in management but is a ${d!.role}`);
  }
});

test("reordering the dropdown did not change the default for a new manager", () => {
  // designationFor() takes the first entry matching the role. If CEO were
  // moved to the top of DESIGNATIONS to get it first on screen, every
  // untitled manager would silently default to CEO.
  assert.equal(designationFor({ title: null, role: "MANAGER" }), "Project Manager");
});
