import { NextResponse } from "next/server";

// Auth wall TEMPORARILY DISABLED — the shell is open, so unauthenticated users
// see the three-doors page directly (no sign-in). NextAuth is left fully in
// place but inactive; re-enable by restoring the two lines below and deleting
// this pass-through middleware.
//
//   export { default } from "next-auth/middleware";
//   export const config = { matcher: ["/((?!auth|api/auth|_next/static|_next/image|favicon.ico).*)"] };
export function middleware() {
  return NextResponse.next();
}
