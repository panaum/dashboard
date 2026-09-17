"use server";

import { headers } from "next/headers";
import { requireAuth } from "@/lib/auth";
import { db } from "@/lib/db";
import { expiryWords, nowSeconds, signReportLink } from "@/lib/layout-checks/report-link";

// A link a client can open: one run, a fortnight, signed with the deployment's
// own secret. Minted here so SPINE_SECRET is read on the server and nowhere
// else, and only for a run that exists. Without a secret there is no link —
// the button says so rather than handing out something guessable.
export async function mintReportLink(runId: string): Promise<{ url: string; expiry: string } | { error: string }> {
  await requireAuth();
  const secret = process.env.SPINE_SECRET || "";
  if (!secret) return { error: "Share links are not configured on this deployment (SPINE_SECRET is unset)." };
  const run = await db.devicePreviewRun.findUnique({ where: { id: runId }, select: { id: true } });
  if (!run) return { error: "That run no longer exists." };
  const now = nowSeconds();
  let token: string;
  try { token = signReportLink(run.id, secret, now); } catch { return { error: "Could not sign the link." }; }
  const h = await headers();
  const proto = h.get("x-forwarded-proto") ?? "https";
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "";
  return { url: `${proto}://${host}/r/${token}`, expiry: expiryWords(now + 14 * 86400, now) };
}
