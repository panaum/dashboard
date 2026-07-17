export { default } from "next-auth/middleware";

// Protect everything except the auth pages/endpoints and Next internals. An
// unauthenticated visitor is bounced to /auth/signin (pages.signIn).
export const config = {
  matcher: ["/((?!auth|api/auth|_next/static|_next/image|favicon.ico).*)"],
};
