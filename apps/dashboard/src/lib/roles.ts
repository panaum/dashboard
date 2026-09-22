import { MEMBER_ROLES } from "./constants";

// WHO DOES WHICH WORK — as a whitelist, always.
//
// This file exists because the blacklist form keeps costing us the same bug.
// `role !== "TESTER"` reads like "developers" right up until a fourth role is
// added, at which point every new role is silently a developer. It happened in
// page-form.tsx (fixed in #191) and it happened again in the Insights picker,
// which is how the CEO ended up with a "pages built per month" chart and a
// "pages QA'd" counter sitting on zero.
//
// Adding a role to MEMBER_ROLES should force a decision here, not inherit one.
// The test walks every role in MEMBER_ROLES against an explicit table, so a new
// one fails the suite until somebody says what it does.

export function buildsPages(role: string): boolean {
  return role === "DEVELOPER" || role === "BOTH";
}

export function testsPages(role: string): boolean {
  return role === "TESTER" || role === "BOTH";
}

/** Someone whose pages built and pages QA'd are worth counting. A manager does
 *  neither and never will, so a per-page scorecard for them is not an empty
 *  state — it is a page that should not exist. */
export function doesPageWork(role: string): boolean {
  return buildsPages(role) || testsPages(role);
}

/** Every role MEMBER_ROLES knows about, for the test's completeness check. */
export const ALL_ROLES: readonly string[] = MEMBER_ROLES;
