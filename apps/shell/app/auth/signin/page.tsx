"use client";

import { signIn } from "next-auth/react";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

function SignInInner() {
  const params = useSearchParams();
  // NextAuth sends error=AccessDenied when the signIn callback rejects a
  // non-apexure account (pages.error points back here).
  const denied = params.get("error") === "AccessDenied";
  const otherError = params.get("error") && !denied;

  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-5 flex size-14 items-center justify-center rounded-2xl border border-line bg-ink-850 shadow-door">
            <span className="font-display text-2xl font-bold tracking-tight text-text-primary">A</span>
          </div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-text-primary">
            Apexure <span className="text-signal">Platform</span>
          </h1>
          <p className="mt-2 text-sm text-text-secondary">One sign-in for the whole QA ecosystem.</p>
        </div>

        <button
          onClick={() => signIn("google", { callbackUrl: "/" })}
          className="flex w-full items-center justify-center gap-3 rounded-xl border border-line bg-ink-850 px-4 py-3 text-sm font-medium text-text-primary transition-colors hover:border-signal/40 hover:bg-ink-800"
        >
          <GoogleGlyph />
          Continue with Google
        </button>

        {denied && (
          <p className="mt-4 rounded-lg border border-red-500/25 bg-red-500/5 px-3 py-2 text-[13px] text-red-300">
            That account isn&apos;t an <span className="font-medium">@apexure.com</span> address. Sign in with your Apexure Google account.
          </p>
        )}
        {otherError && (
          <p className="mt-4 text-[13px] text-text-muted">Sign-in couldn&apos;t complete — please try again.</p>
        )}

        <p className="mt-8 text-center text-xs text-text-muted">Access is limited to the Apexure team.</p>
      </div>
    </main>
  );
}

function GoogleGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden>
      <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.6l6.7-6.7C35.6 2.4 30.1 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.8 6.1C12.3 13.3 17.7 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.1 24.6c0-1.6-.1-3.1-.4-4.6H24v9.1h12.4c-.5 2.9-2.1 5.3-4.6 6.9l7.1 5.5c4.2-3.9 6.6-9.6 6.6-16.9z" />
      <path fill="#FBBC05" d="M10.4 28.3c-.5-1.4-.8-3-.8-4.6s.3-3.2.8-4.6l-7.8-6.1C1 16.2 0 20 0 23.7s1 7.5 2.6 10.7l7.8-6.1z" />
      <path fill="#34A853" d="M24 47.5c6.1 0 11.3-2 15-5.5l-7.1-5.5c-2 1.3-4.6 2.1-7.9 2.1-6.3 0-11.7-3.8-13.6-9.3l-7.8 6.1C6.5 42.6 14.6 47.5 24 47.5z" />
    </svg>
  );
}

export default function SignInPage() {
  return (
    <Suspense>
      <SignInInner />
    </Suspense>
  );
}
