import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { db } from "@/lib/db";
import { PrintButton } from "@/components/shared/print-button";
import { CertificateDocument } from "@/components/qa/certificate-document";
import { TiltCard } from "@/components/qa/tilt-card";

// Tokenised links shouldn't be indexed by search engines.
export const metadata: Metadata = {
  title: "QA Certificate",
  robots: { index: false, follow: false },
};

export default async function PublicCertificatePage({
  params,
}: {
  params: Promise<{ shareId: string }>;
}) {
  const { shareId } = await params;
  const page = await db.page.findUnique({
    where: { shareId },
    include: {
      project: { include: { client: true } },
      developer: true,
      tester: true,
      certificate: {
        include: {
          items: {
            orderBy: { order: "asc" },
            select: {
              category: true,
              name: true,
              result: true,
              valueDesktop: true,
              valueMobile: true,
              isMeasurement: true,
              hasDualValue: true,
            },
          },
        },
      },
      issues: { select: { severity: true, status: true } },
    },
  });
  if (!page) notFound();

  return (
    <main className="min-h-screen bg-page px-4 py-8">
      <div className="mx-auto max-w-3xl">
        <div className="mb-4 flex justify-end print:hidden">
          <PrintButton />
        </div>
        <TiltCard>
          <CertificateDocument page={page} />
        </TiltCard>
        <p className="mt-4 text-center text-[12px] text-text-muted print:hidden">
          Quality assurance certificate · Apexure
        </p>
      </div>
    </main>
  );
}
