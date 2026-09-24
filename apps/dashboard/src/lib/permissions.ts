// PERMISSIONS — who may do what, and where they may go.
//
// Pure. No I/O, no Prisma, no React, no cookies — so every rule below is unit
// testable without a database (see permissions.test.ts).
//
// Two axes, deliberately independent:
//
//   role  DEVELOPER | TESTER | BOTH   — the work a person does. Already in the
//                                       schema; drives page assignment.
//   rank  ADMIN | MEMBER | VIEWER     — how far they can move around the app.
//
// They are separate because they answer different questions. A senior developer
// and a junior developer do the same work; they need not have the same access.
// Collapsing the two would force you to make someone a "tester" to take away
// their edit rights, which would then corrupt the QA assignment data.

export const RANKS = ["ADMIN", "MEMBER", "VIEWER"] as const;
export type Rank = (typeof RANKS)[number];

export const RANK_LABELS: Record<Rank, string> = {
  ADMIN: "Admin",
  MEMBER: "Member",
  VIEWER: "Viewer",
};

export const RANK_BLURB: Record<Rank, string> = {
  ADMIN: "Full access — the team list, board configuration, and revoking anyone's access.",
  MEMBER: "Does the agency's own work: adds clients, signs off QA, fills checklists — plus everything Viewer can do.",
  // Viewer is expected to be mostly developers working boards day to day.
  // Full participation on cards; blocked from the agency's own record-keeping
  // (clients, QA sign-off, checklists) and from permanently removing a
  // comment someone else wrote.
  VIEWER: "Works the boards fully — create, edit, move, comment, archive. Cannot add clients, sign off QA, fill checklists, or delete a comment.",
};

/** Everything the app can be asked for permission to do. Routes and server
 *  actions ask by name rather than comparing rank strings, so adding a rank
 *  never means hunting for `=== "ADMIN"` scattered through the codebase. */
export const CAPABILITIES = [
  "team:view",        // see the team list at all
  "team:manage",      // add, edit, deactivate people — includes revoking a
                       // person's access entirely
  "rank:assign",       // change what someone else may do
  "client:edit",       // create/edit clients, projects
  "page:edit",         // create/edit pages, assign dev/tester
  "issue:write",       // create, edit, move cards; post comments; delete or
                        // archive a card, delete an image
  "comment:delete",    // NEW — remove a comment someone posted. Split out from
                        // issue:write on purpose: a Viewer may freely add and
                        // work cards, but permanently erasing another
                        // person's comment is a different class of action and
                        // stays Member+.
  "board:archive",     // archive or restore a project's board. Open to every
                        // signed-in rank, Viewer included — reversible and
                        // low-risk, so it's not treated as privileged.
  "board:configure",   // NEW — Admin-only. Turning on/off optional board
                        // features for a project (e.g. the triage-inbox
                        // toggle) and any other board-level feature
                        // configuration. Distinct from settings:manage,
                        // which covers environment/integrations, not
                        // per-board feature flags.
  "checklist:fill",    // complete items on a QA checklist
  "qa:sign",           // complete a QA certificate (mark a page QA'ed)
  "check:run",         // run a link/attribution check
  "sharelink:mint",    // mint or revoke a public /c/[shareId] certificate or
                        // /b/ board link
  "registry:write",    // anything that writes to LinkSpy or the registry
  "settings:manage",   // environment, integrations, destructive operations
] as const;
export type Capability = (typeof CAPABILITIES)[number];

const MEMBER_CAPS: Capability[] = [
  "client:edit", "page:edit", "issue:write", "comment:delete",
  "board:archive", "checklist:fill", "qa:sign", "check:run",
];

// VIEWER: full board participant, blocked from the agency's own
// record-keeping and from deleting someone else's comment. This is a real,
// considered set — not an oversight — so it's spelled out here rather than
// left to be "corrected" back to [] or back to full issue:write later.
const VIEWER_CAPS: Capability[] = ["issue:write", "board:archive"];

const BY_RANK: Record<Rank, readonly Capability[]> = {
  ADMIN: CAPABILITIES,
  MEMBER: MEMBER_CAPS,
  VIEWER: VIEWER_CAPS,
};

/** The signed-in person, as far as authorisation is concerned. */
export type Actor = {
  id: string;
  name: string;
  rank: Rank;
  /** True for the shared-password bootstrap session, which has no person behind
   *  it. Treated as ADMIN so you cannot lock yourself out, but it can never
   *  sign QA — an unattributable signature is worth nothing. */
  bootstrap?: boolean;
};

export function can(actor: Actor | null, capability: Capability): boolean {
  if (!actor) return false;
  return BY_RANK[actor.rank].includes(capability);
}

/** Signing off your own build is the one thing rank must never buy — it is the
 *  entire reason this system is worth adding. `QACertificate.testerName` is a
 *  free-text string today, so nothing stops a developer typing any name into
 *  their own certificate. Admins are not exempt: an admin who genuinely must
 *  sign reassigns the page's developer first, which leaves a record. */
export function canSignQa(
  actor: Actor | null,
  page: { developerId?: string | null },
): { ok: boolean; reason?: string } {
  if (!can(actor, "qa:sign")) {
    return { ok: false, reason: "Your access level cannot sign off QA." };
  }
  if (actor!.bootstrap) {
    return { ok: false, reason: "Sign in as yourself to sign off QA — a shared session cannot be attributed." };
  }
  if (page.developerId && page.developerId === actor!.id) {
    return { ok: false, reason: "You built this page, so you cannot also sign off its QA." };
  }
  return { ok: true };
}

// ── where a rank may move around ────────────────────────────────────────────
// Routes are matched by longest prefix, so a new sub-route inherits its
// parent's rule instead of silently defaulting to open.
//
// Monthly, Checklists, and Clients are deliberately NOT listed here: everyone
// signed in can SEE them (falls through to the "/dashboard" catch-all below).
// What Viewer can't do there — add a client, sign QA, fill a checklist item —
// is enforced by checking the relevant capability on the specific button or
// server action, not by blocking the route.

const ROUTE_RULES: ReadonlyArray<{ prefix: string; capability: Capability | null }> = [
  { prefix: "/dashboard/team", capability: "team:view" },
  { prefix: "/dashboard/settings", capability: "settings:manage" },
  { prefix: "/dashboard", capability: null }, // null = any signed-in person
];

export function routeCapability(pathname: string): Capability | null | undefined {
  const hit = [...ROUTE_RULES]
    .sort((a, b) => b.prefix.length - a.prefix.length)
    .find((r) => pathname === r.prefix || pathname.startsWith(r.prefix + "/"));
  return hit ? hit.capability : undefined; // undefined = not a guarded route
}

export function canVisit(actor: Actor | null, pathname: string): boolean {
  if (!actor) return false;
  const need = routeCapability(pathname);
  if (need === undefined || need === null) return true;
  return can(actor, need);
}

/** Nav items a rank should actually see. Hiding what someone cannot reach is a
 *  courtesy, not a control — `canVisit` is still enforced server-side. */
export function visibleNav<T extends { href: string }>(actor: Actor | null, items: T[]): T[] {
  return items.filter((i) => canVisit(actor, i.href));
}
