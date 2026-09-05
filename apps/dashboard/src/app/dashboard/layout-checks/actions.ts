"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import type { ResponsiveFinding } from "@/lib/linkspy/responsive-view";

// Saving a checked page and its history. The sweep itself runs on the Railway
// service; this only records what it found and keeps the screenshots for the
// two most recent runs, which is what a before/after comparison needs.

const KEEP_RUNS_WITH_SHOTS = 2;

function normaliseUrl(raw: string): string | null {
  const t = raw.trim();
  if (!t) return null;
  try {
    const u = new URL(t.includes("://") ? t : `https://${t}`);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    u.hash = "";
    return u.toString();
  } catch {
    return null;
  }
}

function worstOf(findings: ResponsiveFinding[]): { worst: string; fail: number; warn: number } {
  const fail = findings.filter((f) => f.status === "FAIL").length;
  const warn = findings.filter((f) => f.status === "WARN").length;
  const skip = findings.some((f) => f.status === "SKIP");
  return { worst: fail ? "FAIL" : warn ? "WARN" : skip ? "SKIP" : "PASS", fail, warn };
}

/** Add a page to the watch list without checking it yet. */
export async function addLayoutSite(
  _prev: { error?: string; ok?: boolean } | undefined,
  formData: FormData,
): Promise<{ error?: string; ok?: boolean }> {
  await requireAuth();
  const url = normaliseUrl(String(formData.get("url") ?? ""));
  if (!url) return { error: "Enter a valid http(s) URL." };
  const label = String(formData.get("label") ?? "").trim() || null;
  try {
    await db.layoutSite.upsert({
      where: { url },
      update: label ? { label } : {},
      create: { url, label },
    });
  } catch {
    return { error: "Could not save that page." };
  }
  revalidatePath("/dashboard/layout-checks");
  return { ok: true };
}

export async function removeLayoutSite(formData: FormData): Promise<void> {
  await requireAuth();
  const id = String(formData.get("id") ?? "");
  // Runs and their screenshots go with it (onDelete: Cascade).
  if (id) await db.layoutSite.delete({ where: { id } });
  revalidatePath("/dashboard/layout-checks");
}

/** Record a finished sweep, pull its screenshots across, and prune old ones. */
export async function saveLayoutRun(input: {
  url: string;
  checkId: string;
  report: { findings?: ResponsiveFinding[]; shot_widths?: number[] };
}): Promise<{ ok?: boolean; error?: string; runId?: string }> {
  await requireAuth();
  const url = normaliseUrl(input.url);
  if (!url) return { error: "Invalid URL." };

  const findings = (input.report?.findings ?? []) as ResponsiveFinding[];
  if (!findings.length) return { error: "That run produced no findings to save." };
  const { worst, fail, warn } = worstOf(findings);

  const site = await db.layoutSite.upsert({
    where: { url }, update: {}, create: { url },
  });
  const run = await db.layoutRun.create({
    data: { siteId: site.id, findings: findings as unknown as object,
            worst, failCount: fail, warnCount: warn },
  });

  // Screenshots live in the job on the Railway service and expire with it, so
  // they are copied across now or not at all.
  const base = (process.env.LINKSPY_API_URL || "").replace(/\/$/, "");
  const key = process.env.LINKSPY_API_KEY || "";
  const widths = (input.report?.shot_widths ?? []).filter((w) => Number.isFinite(w));
  if (base && key) {
    for (const w of widths) {
      try {
        const res = await fetch(
          `${base}/api/qa-bridge/monitor/responsive-shot?check_id=${encodeURIComponent(input.checkId)}&width=${w}`,
          { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(20000), cache: "no-store" },
        );
        if (!res.ok) continue;
        const buf = Buffer.from(await res.arrayBuffer());
        if (!buf.length) continue;
        await db.layoutShot.create({
          data: { runId: run.id, width: w, image: buf, bytes: buf.length },
        });
      } catch {
        // A missing screenshot must not lose the findings, which are the record.
      }
    }
  }

  await pruneShots(site.id);
  revalidatePath("/dashboard/layout-checks");
  revalidatePath(`/dashboard/layout-checks/${site.id}`);
  return { ok: true, runId: run.id };
}

/** Keep images for the newest runs only; findings history is untouched. */
async function pruneShots(siteId: string): Promise<void> {
  const recent = await db.layoutRun.findMany({
    where: { siteId },
    orderBy: { checkedAt: "desc" },
    select: { id: true },
    take: KEEP_RUNS_WITH_SHOTS,
  });
  const keep = recent.map((r) => r.id);
  await db.layoutShot.deleteMany({
    where: { run: { siteId }, runId: { notIn: keep.length ? keep : ["__none__"] } },
  });
}
