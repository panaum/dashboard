import { z } from "zod";
import {
  PROJECT_TYPES,
  PLATFORMS,
  STATUSES,
  SEVERITIES,
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
  platform: z.enum(PLATFORMS),
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

export const memberSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(80),
  role: z.enum(MEMBER_ROLES),
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
