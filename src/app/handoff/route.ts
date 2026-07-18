import { NextRequest, NextResponse } from "next/server";
import { verifyHandoff } from "@/lib/handoff-contract";

// Inbound handoff from the ecosystem shell: verify the signed token, then forward.
// The token removes friction, it is NOT auth — it never mints a session. If the
// browser already has this app's session cookie, go straight to the target;
// otherwise send to /login. Tamper/expiry → home.
//
// NOTE: adapted for THIS app's auth (shared-password, cookie "session" set by
// @/lib/auth), NOT NextAuth. Do not restore the next-auth cookie names or the
// /api/auth/signin redirect — this app has neither.
const SESSION_COOKIE = "session";

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token") ?? "";
  const secret = process.env.SPINE_SECRET ?? "";
  const home = new URL("/", req.url);

  if (!secret) return NextResponse.redirect(home);

  const v = verifyHandoff(token, secret, Math.floor(Date.now() / 1000));
  if (!v.ok) return NextResponse.redirect(home);

  const target = new URL(v.targetPath, req.url);
  const signedIn = Boolean(req.cookies.get(SESSION_COOKIE)?.value);

  if (signedIn) return NextResponse.redirect(target);

  const login = new URL("/login", req.url);
  login.searchParams.set("callbackUrl", target.toString());
  return NextResponse.redirect(login);
}
