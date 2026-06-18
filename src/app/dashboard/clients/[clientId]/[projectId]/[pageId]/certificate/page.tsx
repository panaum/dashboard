import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { db } from "@/lib/db";
import { PrintButton } from "@/components/shared/print-button";
import { CertificateDocument } from "@/components/qa/certificate-document";
import { ShareCertificate } from "@/components/qa/share-certificate";

export default async function CertificatePage({
  params,
}: {
  params: Promise<{ clientId: string; projectId: string; pageId: string }>;
}) {
  const { clientId, projectId, pageId } = await params;
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
  if (!page || page.projectId !== projectId || page.project.clientId !== clientId)
    notFound();

  const basePath = `/dashboard/clients/${clientId}/${projectId}/${pageId}`;

  return (
    <div className="mx-auto max-w-3xl">
      {/* Toolbar — hidden when printing */}
      <div className="mb-4 flex items-center justify-between print:hidden">
        <Link
          href={basePath}
          className="inline-flex items-center gap-1.5 text-[13px] font-medium text-text-secondary transition-colors hover:text-text-primary"
        >
          <ArrowLeft className="size-4" /> Back to page
        </Link>
        <PrintButton />
      </div>

      <ShareCertificate
        clientId={clientId}
        projectId={projectId}
        pageId={pageId}
        initialShareId={page.shareId}
      />

      <CertificateDocument page={page} />

      <p className="mt-3 text-center text-[12px] text-text-muted print:hidden">
        Send the client the share link above, or use “Download / Print” → Save as
        PDF.
      </p>
    </div>
  );
}
