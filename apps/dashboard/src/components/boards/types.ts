import type { BoardStage } from "@/lib/constants";

// The card as each role sees it. `Card` is what the board draws; only QA's
// carries severity, recurring and reporter — the developer's arrives already
// stripped by developerView(), so this shape is the whitelist made visible.
export type Comment = { id: string; body: string; authorName: string | null; createdAt: string; deletable: boolean };
export type Image = { id: string; filename: string | null; isCover: boolean; bytes: number; createdAt: string };
/** A stage change, already named for the viewer: the developer view has
 *  non-assignee actors labelled "QA" before this leaves the server. */
export type StageEvent = {
  id: string; actorName: string | null; fromStage: BoardStage | null; toStage: BoardStage; createdAt: string;
  /** Why the card moved. Set only on moves that require a reason. */
  note: string | null;
};

export type Card = {
  id: string;
  title: string;
  description: string | null;
  link: string | null;
  boardStage: BoardStage;
  boardOrder: number;
  assigneeId: string | null;
  assigneeName: string | null;
  createdAt: string;
  /** When this card entered the stage it is in — its newest IssueEvent. Drives
   *  the aging glow; null only for a card with no events at all. */
  stageSince: string | null;
  /** Something has happened here since this viewer last opened it. Computed on
   *  the server, per viewer — the client is told, never asked to work it out. */
  unread: boolean;
  startAt: string | null;
  dueAt: string | null;
  /** QA only: minutes before dueAt to ping; absent on the developer view. */
  dueReminderMinutes?: number | null;
  comments: Comment[];
  events: StageEvent[];
  images: Image[];
  /** Labels the composer may autocomplete after "@". Labels only — the ids
   *  are resolved on the server against the same list, so the developer view
   *  never receives the reporter's id or name (it sees "QA"). */
  participants: string[];
  // QA only. Absent on the developer view — never null, absent.
  severity?: string;
  recurring?: boolean;
  reporterName?: string | null;
};

export type Member = { id: string; name: string };

export type MoveInput = { id: string; to: BoardStage; index: number; reason?: string };
export type DatesInput = { id: string; startAt: string | null; dueAt: string | null; dueReminderMinutes: number | null };

export type Result = { ok?: boolean; error?: string };
export type CommentResult = Result & { mentioned?: number; notified?: number; notes?: string[] };
export type ImageResult = Result & { id?: string; filename?: string | null };
