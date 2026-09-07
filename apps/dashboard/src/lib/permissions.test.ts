import { test } from "node:test";
import assert from "node:assert/strict";

import {
  type Actor,
  CAPABILITIES,
  RANKS,
  can,
  canSignQa,
  canVisit,
  routeCapability,
  visibleNav,
} from "./permissions";

const actor = (rank: Actor["rank"], extra: Partial<Actor> = {}): Actor => ({
  id: "m1",
  name: "Test Person",
  rank,
  ...extra,
});

test("admin holds every capability", () => {
  for (const c of CAPABILITIES) {
    assert.equal(can(actor("ADMIN"), c), true, `admin should hold ${c}`);
  }
});

test("viewer holds no capability at all", () => {
  for (const c of CAPABILITIES) {
    assert.equal(can(actor("VIEWER"), c), false, `viewer should not hold ${c}`);
  }
});

test("member does the work but cannot manage access", () => {
  const m = actor("MEMBER");
  assert.equal(can(m, "page:edit"), true);
  assert.equal(can(m, "issue:write"), true);
  assert.equal(can(m, "check:run"), true);
  assert.equal(can(m, "team:view"), false);
  assert.equal(can(m, "team:manage"), false);
  assert.equal(can(m, "rank:assign"), false);
  assert.equal(can(m, "sharelink:mint"), false);
  assert.equal(can(m, "registry:write"), false);
});

test("a signed-out visitor holds nothing", () => {
  for (const c of CAPABILITIES) assert.equal(can(null, c), false);
  assert.equal(canVisit(null, "/dashboard"), false);
});

// ── separation of duties: the rule the whole feature exists for ─────────────

test("a developer cannot sign off QA on their own page", () => {
  const dev = actor("MEMBER", { id: "dev-1" });
  const r = canSignQa(dev, { developerId: "dev-1" });
  assert.equal(r.ok, false);
  assert.match(r.reason!, /built this page/);
});

test("a developer can sign off QA on someone else's page", () => {
  const dev = actor("MEMBER", { id: "dev-1" });
  assert.equal(canSignQa(dev, { developerId: "dev-2" }).ok, true);
});

test("an unassigned page can be signed by any member", () => {
  assert.equal(canSignQa(actor("MEMBER"), { developerId: null }).ok, true);
  assert.equal(canSignQa(actor("MEMBER"), {}).ok, true);
});

test("rank does not buy an exemption — an admin cannot sign their own build", () => {
  const admin = actor("ADMIN", { id: "boss" });
  assert.equal(canSignQa(admin, { developerId: "boss" }).ok, false);
});

test("a viewer cannot sign QA even on a page they did not build", () => {
  const r = canSignQa(actor("VIEWER"), { developerId: "someone-else" });
  assert.equal(r.ok, false);
  assert.match(r.reason!, /access level/);
});

test("the shared bootstrap session is admin but can never sign QA", () => {
  const boot = actor("ADMIN", { id: "bootstrap", bootstrap: true });
  assert.equal(can(boot, "team:manage"), true);
  const r = canSignQa(boot, { developerId: "someone-else" });
  assert.equal(r.ok, false);
  assert.match(r.reason!, /as yourself/);
});

// ── movement around the app ────────────────────────────────────────────────

test("the team area needs team:view; only admin has it", () => {
  assert.equal(routeCapability("/dashboard/team"), "team:view");
  assert.equal(canVisit(actor("ADMIN"), "/dashboard/team"), true);
  assert.equal(canVisit(actor("MEMBER"), "/dashboard/team"), false);
  assert.equal(canVisit(actor("VIEWER"), "/dashboard/team"), false);
});

test("a sub-route inherits its parent's rule rather than defaulting open", () => {
  assert.equal(routeCapability("/dashboard/team/abc123"), "team:view");
  assert.equal(canVisit(actor("MEMBER"), "/dashboard/team/abc123"), false);
});

test("ordinary dashboard routes are open to any signed-in rank", () => {
  for (const r of RANKS) {
    assert.equal(canVisit(actor(r), "/dashboard/clients"), true);
    assert.equal(canVisit(actor(r), "/dashboard/sites"), true);
  }
});

test("a prefix collision does not leak the team area", () => {
  // "/dashboard/teamwork" must not match the "/dashboard/team" rule.
  assert.equal(routeCapability("/dashboard/teamwork"), null);
  assert.equal(canVisit(actor("MEMBER"), "/dashboard/teamwork"), true);
});

test("nav hides what a rank cannot reach", () => {
  const items = [
    { href: "/dashboard/clients" },
    { href: "/dashboard/sites" },
    { href: "/dashboard/team" },
  ];
  assert.deepEqual(visibleNav(actor("MEMBER"), items).map((i) => i.href), [
    "/dashboard/clients",
    "/dashboard/sites",
  ]);
  assert.equal(visibleNav(actor("ADMIN"), items).length, 3);
});
