import { NextRequest } from "next/server";
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
//
// ?url= (the Sites page's "Check a URL" box) prefills LinkSpy's checker. The
// value is parsed and re-serialized — only a real http(s) URL survives into
// the target path; anything else falls back to the plain checker.
export async function GET(req: NextRequest) {
  await requireAuth();
  const base = (process.env.LINKSPY_APP_URL ?? "").replace(/\/$/, "");
  if (!base) redirect("/dashboard");

  let target = "/";
  const raw = (req.nextUrl.searchParams.get("url") ?? "").trim();
  if (raw) {
    try {
      const u = new URL(raw.includes("://") ? raw : `https://${raw}`);
      if (u.protocol === "http:" || u.protocol === "https:") {
        target = `/?url=${encodeURIComponent(u.toString())}`;
      }
    } catch {
      // not a URL — plain checker
    }
  }

  const secret = process.env.SPINE_SECRET;
  if (!secret) redirect(base + (target === "/" ? "" : target));
  redirect(handoffUrl(base, target, secret, Math.floor(Date.now() / 1000)));
}
