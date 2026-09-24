import { z } from "zod";
import {
  PROJECT_TYPES,
  STATUSES,
  SEVERITIES,
  BOARD_STAGES,
  ISSUE_STATUSES,
  MEMBER_ROLES,
  CHECK_RESULTS,
  CERT_STATUSES,
} from "@/lib/constants";

const optionalText = (max = 500) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : null));

export const clientSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  notes: optionalText(1000),
});

export const projectSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(160),
  type: z.enum(PROJECT_TYPES),
  // Platform is an open list: the built-in ones plus any custom platform typed
  // in a form (stored as a plain string, no enum). Kept trimmed + capped.
  platform: z.string().trim().min(1, "Platform is required").max(60),
  url: optionalText(500),
  status: z.enum(STATUSES),
});

export const pageSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(160),
  url: optionalText(500),
  status: z.enum(STATUSES),
  developerId: optionalText(40),
  testerId: optionalText(40),
  delayDays: z.coerce.number().int().min(0).max(3650).default(0),
  deliveryMonth: optionalText(7), // "YYYY-MM"
});

export const issueSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(200),
  description: optionalText(1000),
  severity: z.enum(SEVERITIES),
  status: z.enum(ISSUE_STATUSES),
});

// A card on a board: the issue's own fields plus the board ones. `status`
// (the page-review OPEN/FIXED) is deliberately absent — the board never
// touches it, so the on-time metric never sees board activity.
export const boardCardSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(200),
  description: optionalText(4000),
  link: optionalText(500),
  severity: z.enum(SEVERITIES),
  recurring: z.coerce.boolean().default(false),
  assigneeId: optionalText(40),
});

export const boardStageSchema = z.enum(BOARD_STAGES);

// Inline edits from the card modal: only the keys present are written.
export const boardCardPatchSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(200).optional(),
  description: z.string().trim().max(4000).optional(),
});

// Dates from the card's Dates popover. ISO strings or null; the reminder is
// minutes before the due date, from the fixed list in board-dates.ts.
export const boardDatesSchema = z.object({
  startAt: z.string().datetime().nullable(),
  dueAt: z.string().datetime().nullable(),
  dueReminderMinutes: z.number().int().min(0).max(60 * 24 * 14).nullable(),
});

export const commentSchema = z.object({
  body: z.string().trim().min(1, "Say something").max(4000),
});

// `role` is deliberately absent: the form has one field, and saveMember
// derives the work role from the designation. See src/lib/designations.ts.
/** Name and nickname — the fields a person edits about themselves. The admin
 *  member dialog and /dashboard/personalization render the same fields
 *  (ProfileFields) and validate with this same schema. */
export const profileSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(80),
  nickname: optionalText(40),
});

export const memberSchema = profileSchema.extend({
  title: z.string().trim().min(1, "A role is required").max(60),
  slackUserId: optionalText(40),
});

export const rankRequestSchema = z.object({
  reason: optionalText(500),
});

export const checkResultSchema = z.enum(CHECK_RESULTS);
export const certStatusSchema = z.enum(CERT_STATUSES);

export type ActionResult = { ok?: boolean; error?: string };

/** Parse FormData with a zod schema, returning a flat error string on failure. */
export function parseForm<T extends z.ZodType>(
  schema: T,
  formData: FormData,
): { data: z.infer<T> } | { error: string } {
  const raw = Object.fromEntries(formData.entries());
  const result = schema.safeParse(raw);
  if (!result.success) {
    const first = result.error.issues[0];
    return { error: first?.message ?? "Invalid input." };
  }
  return { data: result.data };
}
