import { NextRequest, NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/auth";
import { liveSocketUrl, signLiveToken } from "@/lib/devicepreview/live-token";

// Mints the one thing the browser is allowed to hold: a short-lived token that
// opens a live session on ONE url and ONE profile. The service key never
// leaves the server, and the socket goes straight from the browser to the
// service — Vercel does not hold websockets, and proxying frames through it
// would double the bandwidth for no gain.
//
// Helpers are declared BELOW the handler: the isolation test asserts the
// requireApiAuth() call precedes any env or network use in source order.

export async function POST(req: NextRequest) {
  const denied = await requireApiAuth();
  if (denied) return denied;

  const base = (process.env.DEVICEPREVIEW_URL || "").replace(/\/+$/, "");
  const key = process.env.DEVICEPREVIEW_KEY || "";
  if (!base || !key) {
    return NextResponse.json({ error: "The preview service is not configured on this deployment." },
                             { status: 503 });
  }

  let body: { url?: unknown; profile?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }
  const url = typeof body.url === "string" ? body.url : "";
  const profile = typeof body.profile === "string" ? body.profile : "";
  if (!/^https?:\/\/\S+$/.test(url) || !isProfileId(profile)) {
    return NextResponse.json({ error: "A valid url and profile are required." }, { status: 400 });
  }

  // The token is returned separately and sent as the socket's first message:
  // in the URL it would be written to the service's access log in full.
  return NextResponse.json({ socketUrl: liveSocketUrl(base), token: signLiveToken(key, url, profile) });
}

/** Profile ids are the slugs in devices.json; anything else is not one. */
function isProfileId(v: string): boolean {
  return /^[a-z0-9-]{2,40}$/.test(v);
}
