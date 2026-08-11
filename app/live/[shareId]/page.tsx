import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { fetchLivingCertificate } from "@/lib/living-certificate";
import { StoryHeader } from "@/components/StoryHeader";

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
// Sections 1–3 (live health, timeline, verification counters) land next; the
// payload already carries their keys as null.

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

  return (
    <main className="min-h-screen px-4 py-10 sm:py-16">
      <div className="mx-auto max-w-3xl">
        {result.kind === "unavailable" ? (
          // Staleness over errors: a client sees a calm sentence, never a stack
          // trace or a 500. The link itself is still good.
          <div className="rounded-2xl border border-line bg-ink-850 p-8 text-center shadow-door">
            <p className="text-sm text-text-secondary">
              This certificate is temporarily unavailable. Please try again shortly.
            </p>
          </div>
        ) : (
          <StoryHeader story={result.data.story} />
        )}

        <p className="mt-6 text-center text-[12px] text-text-muted">
          Living quality certificate · Apexure
        </p>
      </div>
    </main>
  );
}
