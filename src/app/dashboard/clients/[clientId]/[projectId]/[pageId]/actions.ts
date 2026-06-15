"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import {
  issueSchema,
  parseForm,
  checkResultSchema,
  certStatusSchema,
  type ActionResult,
} from "@/lib/validation";
import { runQaAgent, type QaProposal } from "@/lib/ai/qa-agent";
import { SEVERITIES } from "@/lib/constants";

type PathParts = { clientId: string; projectId: string; pageId: string };

function pagePath({ clientId, projectId, pageId }: PathParts) {
  return `/dashboard/clients/${clientId}/${projectId}/${pageId}`;
}

// --- QA checklist items -----------------------------------------------------

export async function updateCheckItem(input: {
  itemId: string;
  result?: string;
  valueDesktop?: string | null;
  valueMobile?: string | null;
  notes?: string | null;
  path: PathParts;
}) {
  const data: Record<string, unknown> = {};
  if (input.result !== undefined) {
    const r = checkResultSchema.safeParse(input.result);
    if (!r.success) return { error: "Invalid result." };
    data.result = r.data;
  }
  if (input.valueDesktop !== undefined) data.valueDesktop = input.valueDesktop || null;
  if (input.valueMobile !== undefined) data.valueMobile = input.valueMobile || null;
  if (input.notes !== undefined) data.notes = input.notes || null;

  await db.qACheckItem.update({ where: { id: input.itemId }, data });
  revalidatePath(pagePath(input.path));
  return { ok: true };
}

export async function setCertStatus(input: {
  certId: string;
  status: string;
  path: PathParts;
}) {
  const r = certStatusSchema.safeParse(input.status);
  if (!r.success) return { error: "Invalid status." };
  await db.qACertificate.update({
    where: { id: input.certId },
    data: {
      status: r.data,
      completedAt: r.data === "IN_PROGRESS" ? null : new Date(),
    },
  });
  revalidatePath(pagePath(input.path));
  return { ok: true };
}

// --- Issues -----------------------------------------------------------------

export async function saveIssue(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const pageId = String(formData.get("pageId") ?? "");
  const clientId = String(formData.get("clientId") ?? "");
  const projectId = String(formData.get("projectId") ?? "");
  if (!pageId) return { error: "Missing page." };

  const parsed = parseForm(issueSchema, formData);
  if ("error" in parsed) return { error: parsed.error };

  const id = String(formData.get("id") ?? "");
  try {
    if (id) {
      await db.issue.update({ where: { id }, data: parsed.data });
    } else {
      await db.issue.create({ data: { ...parsed.data, pageId } });
    }
  } catch {
    return { error: "Could not save issue." };
  }

  revalidatePath(pagePath({ clientId, projectId, pageId }));
  revalidatePath("/dashboard");
  return { ok: true };
}

export async function toggleIssue(input: {
  id: string;
  status: string;
  path: PathParts;
}) {
  await db.issue.update({
    where: { id: input.id },
    data: { status: input.status === "OPEN" ? "FIXED" : "OPEN" },
  });
  revalidatePath(pagePath(input.path));
  return { ok: true };
}

export async function setPageUrl(input: { pageId: string; url: string; path: PathParts }) {
  const url = input.url.trim();
  await db.page.update({ where: { id: input.pageId }, data: { url: url || null } });
  revalidatePath(pagePath(input.path));
  return { ok: true };
}

// --- AI QA agent ------------------------------------------------------------

export async function analyzeUrl(url: string): Promise<QaProposal> {
  const trimmed = url?.trim();
  if (!trimmed || !/^https?:\/\//i.test(trimmed)) {
    return { ok: false, error: "Enter a valid http(s) URL.", aiUsed: false, checks: [], issues: [] };
  }
  return runQaAgent(trimmed);
}

export async function applyProposal(input: {
  certId: string;
  pageId: string;
  path: PathParts;
  checks: { name: string; result: string; valueDesktop?: string | null }[];
  issues: { title: string; severity: string }[];
}) {
  // Update matching checklist items by name within this certificate.
  for (const c of input.checks) {
    await db.qACheckItem.updateMany({
      where: { certificateId: input.certId, name: c.name },
      data: {
        result: c.result,
        ...(c.valueDesktop !== undefined && c.valueDesktop !== null
          ? { valueDesktop: c.valueDesktop }
          : {}),
      },
    });
  }

  // Create the suggested issues (validate severity defensively).
  const valid = input.issues.filter((i) =>
    (SEVERITIES as readonly string[]).includes(i.severity),
  );
  if (valid.length) {
    await db.issue.createMany({
      data: valid.map((i) => ({
        pageId: input.pageId,
        title: i.title.slice(0, 200),
        severity: i.severity,
        status: "OPEN",
      })),
    });
  }

  revalidatePath(pagePath(input.path));
  revalidatePath("/dashboard");
  return { ok: true, applied: input.checks.length, created: valid.length };
}

export async function deleteIssue(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  const clientId = String(formData.get("clientId") ?? "");
  const projectId = String(formData.get("projectId") ?? "");
  const pageId = String(formData.get("pageId") ?? "");
  if (id) await db.issue.delete({ where: { id } });
  revalidatePath(pagePath({ clientId, projectId, pageId }));
}
