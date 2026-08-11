import { NextResponse } from "next/server";

// Auth wall TEMPORARILY DISABLED — the shell is open, so unauthenticated users
// see the three-doors page directly (no sign-in). NextAuth is left fully in
// place but inactive; re-enable by restoring the two lines below and deleting
// this pass-through middleware.
//
//   export { default } from "next-auth/middleware";
//   export const config = { matcher: [PUBLIC_EXEMPT] };
//
// ═══ READ THIS BEFORE RE-ENABLING ═══
// `/live/{shareId}` is a CLIENT-FACING certificate. Clients have no accounts and
// never will — the share token IS the credential, exactly as the Dashboard's
// /c/{shareId} works. Putting it behind the auth wall does not make it more
// secure; it makes every client's certificate a sign-in page they cannot pass.
//
// The exemption below is therefore part of the route's contract, not a
// convenience. It is written out now, while the reason is obvious, so that
// whoever restores the two lines above inherits it instead of rediscovering it
// through a client's confused email.
export const PUBLIC_EXEMPT =
  "/((?!live|auth|api/auth|_next/static|_next/image|favicon.ico).*)";

export function middleware() {
  return NextResponse.next();
}
