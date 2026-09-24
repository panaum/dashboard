import Link from "next/link";
import { Logo } from "@/components/shared/logo";

export const metadata = { title: "Sorry to see you go", robots: { index: false } };

// Where "Leave the workspace" lands. Public by necessity: the session was
// ended a moment ago. It reads nothing and names nobody.
export default function GoodbyePage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-page px-4 py-10">
      <div className="w-full max-w-md rounded-2xl border border-border-soft bg-card p-8 text-center shadow-md">
        <div className="mx-auto mb-5 flex size-12 items-center justify-center rounded-xl border border-border-soft bg-card shadow-sm">
          <Logo className="size-7" />
        </div>
        <h1 className="text-2xl font-semibold tracking-tight text-text-primary">Sorry to see you go</h1>
        <p className="mt-3 text-sm leading-relaxed text-text-secondary">
          You’ve left the Apexure workspace and been signed out. Everything you worked on stays, with your name on it.
        </p>
        <p className="mt-2 text-sm leading-relaxed text-text-secondary">
          If this was a mistake, ask an admin to restore your access.
        </p>
        <Link
          href="/login"
          className="mt-6 inline-flex items-center justify-center rounded-full border border-border-soft bg-card px-5 py-2.5 text-sm font-medium text-text-primary shadow-xs transition-colors hover:border-accent/50 hover:bg-accent/[0.06]"
        >
          Back to sign in
        </Link>
      </div>
    </main>
  );
}
