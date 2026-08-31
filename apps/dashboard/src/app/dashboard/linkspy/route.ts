import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { handoffUrl } from "@/lib/handoff-contract";

// The sidebar's door into LinkSpy. Verifies the team session first — this
// route mints with SPINE_SECRET, so it must never answer an anonymous
// browser — then signs the same short-lived handoff token the shell's doors
// mint and hops to LinkSpy's /handoff, which forwards a browser that already
// holds a LinkSpy session (or sends it to sign-in once). Degrades to the
// plain LinkSpy URL when the secret is unset; to the dashboard when even the
// base URL is missing.
export async function GET() {
  await requireAuth();
  const base = (process.env.LINKSPY_APP_URL ?? "").replace(/\/$/, "");
  if (!base) redirect("/dashboard");
  const secret = process.env.SPINE_SECRET;
  if (!secret) redirect(base);
  redirect(handoffUrl(base, "/", secret, Math.floor(Date.now() / 1000)));
}
