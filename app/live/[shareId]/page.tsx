import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { fetchLivingCertificate } from "@/lib/living-certificate";
import { StoryHeader } from "@/components/StoryHeader";
import { VerificationCounters } from "@/components/VerificationCounters";
import { LiveHealthStrip } from "@/components/LiveHealthStrip";

// LIVING CERTIFICATE — /live/{shareId}
//
// A richer rendering of the capability that already exists. `Page.shareId` is
// the one token: the Dashboard's /c/{shareId} renders the formal certificate,
// this renders the living one. Revocation is inherited — null the column and
// both die at once. There is no second token and no sign-in.
//
// ⚠ PUBLIC BY DESIGN. This route must never sit behind the shell's auth wall.
// See the exclusion in middleware.ts.
//
// Sections shipped: 4 (story header), 3 (verification counters), 1 (live health).
// Section 2 (timeline) lands next; the payload already carries its key as null.

// Tokenised links are not for search engines — same posture as /c/{shareId}.
export const metadata: Metadata = {
  title: "Living Certificate",
  robots: { index: false, follow: false },
};

export default async function LivingCertificatePage({
  params,
}: {
  params: { shareId: string };
}) {
  const result = await fetchLivingCertificate(params.shareId);

  // Revoked, never enabled, or the feature is off — all indistinguishable.
  if (result.kind === "gone") notFound();

  // One clock read for the whole render, so no two sections can disagree about
  // what "now" is.
  const now = new Date();

  return (
    <main className="min-h-screen px-4 py-10 sm:py-16">
      <div className="mx-auto flex max-w-3xl flex-col gap-5">
        {result.kind === "unavailable" ? (
          // Staleness over errors: a client sees a calm sentence, never a stack
          // trace or a 500. The link itself is still good.
          <div className="rounded-2xl border border-lc-line bg-lc-card p-8 text-center shadow-lc">
            <p className="text-sm text-lc-secondary">
              This certificate is temporarily unavailable. Please try again shortly.
            </p>
          </div>
        ) : (
          <>
            <StoryHeader story={result.data.story} />
            {/* null means the page is not mapped on LinkSpy — we never looked,
                which is not the same as looking and finding nothing. Five grey
                chips would imply the former. */}
            {result.data.live_health && (
              <LiveHealthStrip health={result.data.live_health} now={now} />
            )}
            {/* null means "no honest counter exists" (an ungraded checklist),
                not "zero checks hold" — so the section is absent, not empty. */}
            {result.data.verification && (
              <VerificationCounters verification={result.data.verification} now={now} />
            )}
          </>
        )}

        <p className="text-center text-[12px] text-lc-muted">
          Living quality certificate · Apexure
        </p>
      </div>
    </main>
  );
}
