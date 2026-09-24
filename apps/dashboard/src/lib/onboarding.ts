// ONBOARDING — the tour's steps and the state of a rank-change request.
//
// Pure, like permissions.ts: no I/O, no React, so every rule here is unit
// tested (onboarding.test.ts). The components only render what these decide.

import { type Actor, type Rank, RANKS, visibleNav } from "./permissions";

// ── the tour ────────────────────────────────────────────────────────────────

/** A stop on the tour. `href` is what visibleNav filters on — the tour is the
 *  sidebar's own rule applied to a list, not a second permission check — and
 *  `target` is the element the spotlight lands on (`data-tour="…"`). */
export type TourStep = {
  id: string;
  href: string;
  target: string;
  title: string;
  body: string;
};

const STEPS: ReadonlyArray<TourStep | ((actor: Actor) => TourStep)> = [
  {
    id: "boards", href: "/dashboard/boards", target: "boards",
    title: "Boards",
    body: "Where the day-to-day work happens: every card, who has it, and what stage it is at.",
  },
  {
    id: "team", href: "/dashboard/team", target: "team",
    title: "Team",
    body: "Everyone on the workspace, what they do, and who may do what.",
  },
  {
    id: "layout-checks", href: "/dashboard/layout-checks", target: "layout-checks",
    title: "Layout checks",
    body: "The cross-device audit: how a page renders on phones, tablets and desktops.",
  },
  {
    id: "insights", href: "/dashboard/insights", target: "insights",
    title: "Insights",
    body: "Where the numbers live: delivery, quality and trends across the year.",
  },
  (actor) => ({
    id: "records", href: "/dashboard/checklists", target: "checklists",
    title: "Checklists and clients",
    body: actor.rank === "VIEWER"
      // A Viewer can open these but not act on them; the copy must not
      // suggest otherwise.
      ? "The record-keeping side: QA checklists and the client list. You can look through both; filling them in is Member work."
      : "The record-keeping side: QA checklists you fill in, and the clients and projects they belong to.",
  }),
  (actor) => ({
    id: "profile", href: "/dashboard/personalization", target: "profile",
    title: "Personalization",
    body: actor.rank === "VIEWER"
      ? "Change your name, nickname and photo, retake this tour, or ask for Member access whenever you need it."
      : "Change your name, nickname and photo, or retake this tour.",
  }),
];

/** The tour this person should see, right now. Computed at the moment the
 *  tour starts, so a Viewer promoted since onboarding gets the fuller one on
 *  a retake. */
export function tourFor(actor: Actor | null): TourStep[] {
  if (!actor) return [];
  const all = STEPS.map((s) => (typeof s === "function" ? s(actor) : s));
  return visibleNav(actor, all);
}

// ── rank-change requests ────────────────────────────────────────────────────

export const REQUEST_STATUSES = ["pending", "approved", "denied"] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

export type RequestRow = {
  id: string;
  fromRank: string;
  toRank: string;
  status: string;
  reason: string | null;
  reviewNote: string | null;
  createdAt: Date | string;
  reviewedAt: Date | string | null;
};

/** What the profile page's access section shows. `canRequest` is the one
 *  flag the server action also checks, so the button and the rule agree. */
export type AccessState =
  | { kind: "none"; canRequest: boolean }
  | { kind: "pending"; request: RequestRow; canRequest: false }
  | { kind: "denied"; request: RequestRow; canRequest: boolean }
  | { kind: "approved"; request: RequestRow; canRequest: boolean };

/** Only a Viewer asks, and only for Member; admins are never prompted. */
export function mayRequestMember(rank: Rank): boolean {
  return rank === "VIEWER";
}

/** Given the person's most recent request (or none), what they see. A denial
 *  does not block asking again — no cooldown, by decision: an admin who still
 *  disagrees denies again, which is cheaper than a timer nobody asked for. */
export function accessState(rank: Rank, latest: RequestRow | null): AccessState {
  const eligible = mayRequestMember(rank);
  if (!latest) return { kind: "none", canRequest: eligible };
  if (latest.status === "pending") return { kind: "pending", request: latest, canRequest: false };
  if (latest.status === "denied") return { kind: "denied", request: latest, canRequest: eligible };
  return { kind: "approved", request: latest, canRequest: eligible };
}

export function isRank(value: string): value is Rank {
  return (RANKS as readonly string[]).includes(value);
}
