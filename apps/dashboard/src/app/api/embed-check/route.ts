import { NextRequest, NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/auth";
import { embedDecision } from "@/lib/layout-checks/embed";

// Can this page be shown live inside the device frame? The browser will not
// tell us — a refused frame is opaque to script — so the server asks the site
// and reads the same two headers a browser would.
//
// Helpers are declared BELOW the handler: the isolation test asserts the
// requireApiAuth() call precedes any network or env use in source order.

const TIMEOUT_MS = 8000;

export async function GET(req: NextRequest) {
  const denied = await requireApiAuth();
  if (denied) return denied;

  const url = req.nextUrl.searchParams.get("url") ?? "";
  if (!/^https?:\/\/\S+$/.test(url)) {
    return NextResponse.json({ error: "a valid http(s) url is required" }, { status: 400 });
  }
  const origin = req.nextUrl.origin;

  try {
    const res = await probe(url);
    const verdict = embedDecision(
      {
        xFrameOptions: res.headers.get("x-frame-options"),
        contentSecurityPolicy: res.headers.get("content-security-policy"),
      },
      res.url || url,
      origin,
    );
    // A page that does not answer cannot be framed either, and saying so is
    // more use than an empty frame the reader has to interpret.
    if (!res.ok && res.status >= 400) {
      return NextResponse.json({
        embeddable: false,
        reason: `The page answered HTTP ${res.status}, so there is nothing to show.`,
        status: res.status,
      });
    }
    return NextResponse.json({ ...verdict, status: res.status });
  } catch {
    return NextResponse.json({ embeddable: false, reason: "The page could not be reached from here." });
  }
}

/** HEAD first; some servers refuse it, so fall back to a GET we do not read. */
async function probe(url: string): Promise<Response> {
  const init = {
    redirect: "follow" as const,
    signal: AbortSignal.timeout(TIMEOUT_MS),
    cache: "no-store" as const,
    headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36" },
  };
  const head = await fetch(url, { ...init, method: "HEAD" });
  if (head.status !== 405 && head.status !== 501) return head;
  return fetch(url, { ...init, method: "GET" });
}
