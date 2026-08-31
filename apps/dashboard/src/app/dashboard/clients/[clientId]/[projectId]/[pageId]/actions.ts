"use server";

import { revalidatePath } from "next/cache";
import { randomBytes } from "node:crypto";
import { db } from "@/lib/db";
import { spineEmitEnabled, emitQaCompleted } from "@/lib/spine-emit";
import { shouldEmitCompleted } from "@/lib/spine-contract";
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
  const completedAt = r.data === "IN_PROGRESS" ? null : new Date();

  // Spine (Phase 2B): emit qa.completed when a REGISTRY-LINKED cert transitions
  // IN_PROGRESS -> PASS/FAIL, in the same transaction. SPINE_EMIT off => plain
  // update, byte-identical to before.
  const cert = await db.qACertificate.findUnique({
    where: { id: input.certId },
    select: {
      status: true, pageId: true,
      page: { select: { registryDeliverableId: true, registrySiteId: true } },
      items: { select: { result: true } },
    },
  });
  const emit = shouldEmitCompleted(spineEmitEnabled(), r.data, cert?.status, Boolean(cert?.page?.registryDeliverableId));

  if (emit && cert) {
    const summary = {
      passed: cert.items.filter((i) => i.result === "PASSED").length,
      failed: cert.items.filter((i) => i.result === "FAILED").length,
      na: cert.items.filter((i) => i.result === "NA").length,
    };
    await db.$transaction(async (tx) => {
      await tx.qACertificate.update({ where: { id: input.certId }, data: { status: r.data, completedAt } });
      await emitQaCompleted(tx, {
        pageId: cert.pageId,
        registryDeliverableId: cert.page!.registryDeliverableId,
        registrySiteId: cert.page!.registrySiteId,
        summary,
      });
    });
  } else {
    await db.qACertificate.update({
      where: { id: input.certId },
      data: { status: r.data, completedAt },
    });
  }
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

// --- Public certificate share link -----------------------------------------

/** Create (or return existing) a public share token for this page's certificate. */
export async function createShareLink(input: { pageId: string; path: PathParts }) {
  const existing = await db.page.findUnique({
    where: { id: input.pageId },
    select: { shareId: true },
  });
  let shareId = existing?.shareId ?? null;
  if (!shareId) {
    shareId = randomBytes(12).toString("base64url");
    await db.page.update({ where: { id: input.pageId }, data: { shareId } });
  }
  revalidatePath(`${pagePath(input.path)}/certificate`);
  return { ok: true as const, shareId };
}

/** Revoke the public link — the URL stops working immediately. */
export async function revokeShareLink(input: { pageId: string; path: PathParts }) {
  await db.page.update({ where: { id: input.pageId }, data: { shareId: null } });
  revalidatePath(`${pagePath(input.path)}/certificate`);
  return { ok: true as const };
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

// --- Phase 3: machine pre-fill confirmation ---------------------------------
// The human Confirm click is the ONLY bridge from a machine result into the
// human checklist row (T4). It writes the result AND stamps provenance. No
// background code path ever writes these fields.
type MachinePrefill = { itemId: string; verdict: string; detail?: string | null; checkedAt?: string | null };

function verdictToResult(v: string): "PASSED" | "FAILED" | "NA" {
  return v === "holding" ? "PASSED" : v === "failing" ? "FAILED" : "NA";
}

async function confirmOne(p: MachinePrefill) {
  await db.qACheckItem.update({
    where: { id: p.itemId },
    data: {
      result: verdictToResult(p.verdict),
      machineVerdict: p.verdict,
      machineDetail: p.detail ?? null,
      machineCheckedAt: p.checkedAt ? new Date(p.checkedAt) : null,
      confirmedSource: "machine",
      confirmedBy: "team", // shared-login app: no per-user identity
      confirmedAt: new Date(),
    },
  });
}

export async function confirmMachineItem(input: MachinePrefill & { path: PathParts }) {
  await confirmOne(input);
  revalidatePath(pagePath(input.path));
  return { ok: true };
}

export async function confirmAllMachinePassed(input: { path: PathParts; items: MachinePrefill[] }) {
  const passed = input.items.filter((i) => i.verdict === "holding");
  for (const it of passed) await confirmOne(it);
  revalidatePath(pagePath(input.path));
  return { ok: true, confirmed: passed.length };
}
