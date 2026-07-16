import { NextRequest, NextResponse } from "next/server";
import { verifyHandoff } from "@/lib/handoff-contract";

// Inbound handoff from LinkSpy: verify the signed token, then forward. The token
// is friction-removal, NOT auth — it never creates a session. If the browser
// already has our session cookie, go straight to the target; otherwise send to
// /login with a safe callbackUrl. Staleness/tamper → home.
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token") ?? "";
  const secret = process.env.SPINE_SECRET ?? "";
  const home = new URL("/dashboard", req.url);
  if (!secret) return NextResponse.redirect(home);

  const v = verifyHandoff(token, secret, Math.floor(Date.now() / 1000));
  if (!v.ok) return NextResponse.redirect(home);

  const target = new URL(v.targetPath, req.url); // relative path, resolved on our origin
  const signedIn = Boolean(req.cookies.get("session")?.value);
  if (signedIn) return NextResponse.redirect(target);

  const login = new URL("/login", req.url);
  login.searchParams.set("callbackUrl", target.pathname + target.search);
  return NextResponse.redirect(login);
}
