import type { NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";

// Sign in ONCE with the same Google account used for the Dashboard. JWT strategy
// (the shell owns no data). Access is restricted to @apexure.com at the server.
const ALLOWED_DOMAIN = "apexure.com";

export const authOptions: NextAuthOptions = {
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID ?? "",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
      // hd is a UX hint to Google; the real gate is the signIn callback below.
      authorization: { params: { hd: ALLOWED_DOMAIN, prompt: "select_account" } },
    }),
  ],
  session: { strategy: "jwt" },
  pages: { signIn: "/auth/signin", error: "/auth/signin" },
  callbacks: {
    // Server-side gate: only @apexure.com may sign in.
    async signIn({ profile, user }) {
      const email = (profile as { email?: string } | undefined)?.email ?? user?.email ?? "";
      return email.toLowerCase().endsWith(`@${ALLOWED_DOMAIN}`);
    },
    async jwt({ token, profile }) {
      if (profile) {
        token.email = (profile as { email?: string }).email ?? token.email;
        token.name = (profile as { name?: string }).name ?? token.name;
        token.picture = (profile as { picture?: string }).picture ?? token.picture;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.email = (token.email as string) ?? session.user.email;
        session.user.name = (token.name as string) ?? session.user.name;
        session.user.image = (token.picture as string) ?? session.user.image;
      }
      return session;
    },
  },
};
