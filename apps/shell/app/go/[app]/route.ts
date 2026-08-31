import { NextRequest, NextResponse } from "next/server";
import { handoffUrl } from "@/lib/handoff-contract";

// The door target. A live door signs a fresh handoff token SERVER-SIDE (the
// SPINE_SECRET never touches the client) and 302-redirects to the destination
// app's /handoff endpoint, which verifies + forwards. Board has no entry here.
const DEST: Record<string, string | undefined> = {
  dashboard: process.env.DASHBOARD_URL,
  linkspy: process.env.LINKSPY_URL,
};

export async function GET(req: NextRequest, ctx: { params: { app: string } }) {
  const base = DEST[ctx.params.app];
  const secret = process.env.SPINE_SECRET;
  if (!base || !secret) {
    // Misconfigured or unknown door → back to the shell, never an error page.
    return NextResponse.redirect(new URL("/", req.url));
  }
  const url = handoffUrl(base, "/", secret, Math.floor(Date.now() / 1000));
  return NextResponse.redirect(url);
}
