import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import type { DpReport } from "@/lib/devicepreview/history";
import { nowSeconds, verifyReportLink } from "@/lib/layout-checks/report-link";
import { ReportBody } from "@/components/layout-checks/report-body";

// THE REPORT, for the client: reached by a signed link and nothing else. No
// login, no navigation, no way into the rest of the Dashboard — the token
// names one run and this page shows that run. Not indexable: a link is for
// the person it was sent to.

export const metadata: Metadata = { title: "Layout check report", robots: { index: false, follow: false } };

export default async function SharedReportPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const v = verifyReportLink(token, process.env.SPINE_SECRET || "", nowSeconds());
  if (!v.ok) notFound();
  const run = await db.devicePreviewRun.findUnique({ where: { id: v.runId }, include: { site: { select: { url: true, label: true } } } });
  if (!run) notFound();
  return (
    <main className="min-h-screen bg-page px-4 py-8 @3xl:px-8">
      <ReportBody
        site={run.site}
        run={{ id: run.id, checkedAt: run.checkedAt, report: run.report as unknown as DpReport }}
        shotUrl={(profileId) => `/api/r/${encodeURIComponent(token)}/shot?profile=${encodeURIComponent(profileId)}`}
      />
    </main>
  );
}
