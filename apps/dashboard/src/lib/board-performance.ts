// Per-developer board performance, computed from the event log — pure, no
// DB, no React, no `Date` read. The caller supplies the period bounds.
//
// This is a SECOND view beside the on-time-delivery one in team-performance.ts,
// never blended with it. Delivery measures pages shipped on time; this
// measures how a developer handles the faults QA finds. Different questions,
// different numbers, same profile page.

import type { BoardStage } from "./constants";
import { isBounceBack } from "./boards";

export type BoardEvent = {
  issueId: string;
  fromStage: BoardStage | null;
  toStage: BoardStage;
  actorId: string | null;
  createdAt: Date | string;
};

export type BoardIssue = {
  id: string;
  assigneeId: string | null;
  recurring: boolean;
  createdAt: Date | string;
};

export type Period = { from: Date | string; to: Date | string };

export type DevBoardPerf = {
  id: string;
  /** Cards assigned to them that were created inside the period. */
  assigned: number;
  /** Cards of theirs that reached CLOSED inside the period. */
  closed: number;
  /** Cards of theirs that reached COMPLETED inside the period. */
  completed: number;
  /** Mean hours from the first NEW event to the first COMPLETED event, over
   *  cards that completed in the period. Null when none did. */
  cycleHours: number | null;
  /** Times one of their cards was pulled back from COMPLETED or CLOSED into
   *  ACTIVE inside the period — the quality signal. */
  bounceBacks: number;
  /** Cards assigned to them, in the period, flagged recurring. */
  recurring: number;
};

export type BoardPerformance = {
  devs: DevBoardPerf[];
  totals: { assigned: number; closed: number; bounceBacks: number };
};

const ms = (d: Date | string) => new Date(d).getTime();

function inPeriod(at: Date | string, p: Period): boolean {
  const t = ms(at);
  return t >= ms(p.from) && t < ms(p.to);
}

/**
 * Compute the panel. Attribution is by the card's assignee at the time of
 * computing — the one the card currently names — because the event log
 * records who ACTED, and a bounce-back is QA's act against the developer's
 * card, not the developer's own.
 */
export function computeBoardPerformance(
  issues: BoardIssue[],
  events: BoardEvent[],
  period: Period,
): BoardPerformance {
  const owner = new Map(issues.map((i) => [i.id, i.assigneeId]));
  const devs = new Map<string, DevBoardPerf>();
  const ensure = (id: string) =>
    devs.get(id) ??
    devs.set(id, { id, assigned: 0, closed: 0, completed: 0, cycleHours: null,
                   bounceBacks: 0, recurring: 0 }).get(id)!;

  for (const i of issues) {
    if (!i.assigneeId || !inPeriod(i.createdAt, period)) continue;
    const d = ensure(i.assigneeId);
    d.assigned++;
    if (i.recurring) d.recurring++;
  }

  // First time each card entered NEW and COMPLETED, for cycle time.
  const firstNew = new Map<string, number>();
  const firstCompleted = new Map<string, number>();
  const sorted = [...events].sort((a, b) => ms(a.createdAt) - ms(b.createdAt));
  for (const e of sorted) {
    if (e.toStage === "NEW" && !firstNew.has(e.issueId)) firstNew.set(e.issueId, ms(e.createdAt));
    if (e.toStage === "COMPLETED" && !firstCompleted.has(e.issueId)) {
      firstCompleted.set(e.issueId, ms(e.createdAt));
    }
  }

  const cycles = new Map<string, number[]>();
  for (const e of sorted) {
    const dev = owner.get(e.issueId);
    if (!dev || !inPeriod(e.createdAt, period)) continue;
    const d = ensure(dev);
    if (e.toStage === "CLOSED") d.closed++;
    if (e.toStage === "COMPLETED" && firstCompleted.get(e.issueId) === ms(e.createdAt)) {
      d.completed++;
      const started = firstNew.get(e.issueId);
      if (started !== undefined) {
        const list = cycles.get(dev) ?? [];
        list.push((ms(e.createdAt) - started) / 3_600_000);
        cycles.set(dev, list);
      }
    }
    if (isBounceBack(e.fromStage, e.toStage)) d.bounceBacks++;
  }
  for (const [dev, list] of cycles) {
    const d = devs.get(dev);
    if (d && list.length) {
      d.cycleHours = Math.round((list.reduce((s, v) => s + v, 0) / list.length) * 10) / 10;
    }
  }

  const list = [...devs.values()].sort(
    (a, b) => b.assigned - a.assigned || a.id.localeCompare(b.id),
  );
  return {
    devs: list,
    totals: {
      assigned: list.reduce((s, d) => s + d.assigned, 0),
      closed: list.reduce((s, d) => s + d.closed, 0),
      bounceBacks: list.reduce((s, d) => s + d.bounceBacks, 0),
    },
  };
}

/** "2026-09" → the period it names, half-open, in UTC. */
export function monthPeriod(month: string): Period {
  const [y, m] = month.split("-").map(Number);
  return { from: new Date(Date.UTC(y, m - 1, 1)), to: new Date(Date.UTC(y, m, 1)) };
}
