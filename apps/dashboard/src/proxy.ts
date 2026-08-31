import { NextResponse, type NextRequest } from "next/server";

// Lightweight UX guard: bounce unauthenticated users away from /dashboard.
// Full signature verification happens server-side in the dashboard layout.
export function proxy(req: NextRequest) {
  const hasSession = req.cookies.has("session");
  if (!hasSession) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard/:path*"],
};
