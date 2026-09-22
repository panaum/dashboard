import test from "node:test";
import assert from "node:assert/strict";

import { MEMBER_ROLES } from "./constants";
import { DESIGNATIONS, designationFor, memberLabel, roleForDesignation } from "./designations";
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
