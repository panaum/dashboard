import type { BoardStage } from "@/lib/constants";

// The card as each role sees it. `Card` is what the board draws; only QA's
// carries severity, recurring and reporter — the developer's arrives already
// stripped by developerView(), so this shape is the whitelist made visible.
export type Comment = { id: string; body: string; authorName: string | null; createdAt: string };
export type Image = { id: string };

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
  comments: Comment[];
  images: Image[];
  // QA only. Absent on the developer view — never null, absent.
  severity?: string;
  recurring?: boolean;
  reporterName?: string | null;
};

export type Member = { id: string; name: string };

export type MoveInput = { id: string; to: BoardStage; index: number };
