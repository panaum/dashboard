import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ArrowLeft } from "lucide-react";
import { db } from "@/lib/db";
import { PrintButton } from "@/components/shared/print-button";
import { CertificateDocument } from "@/components/qa/certificate-document";
import { TiltCard } from "@/components/qa/tilt-card";

export const metadata: Metadata = {
  title: "QA Certificate",
  robots: { index: false, follow: false },
};

export default async function PortalCertificatePage({
  params,
}: {
  params: Promise<{ portalId: string; pageId: string }>;
}) {
  const { portalId, pageId } = await params;
  const page = await db.page.findUnique({
    where: { id: pageId },
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

  // The portal token only authorises pages belonging to its own client.
  if (!page || page.project.client.portalId !== portalId) notFound();

  return (
    <main className="min-h-screen bg-page px-4 py-8">
      <div className="mx-auto max-w-3xl">
        <div className="mb-4 flex items-center justify-between print:hidden">
          <Link
            href={`/portal/${portalId}`}
            className="inline-flex items-center gap-1.5 text-[13px] font-medium text-text-secondary transition-colors hover:text-text-primary"
          >
            <ArrowLeft className="size-4" />
            All deliverables
          </Link>
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
