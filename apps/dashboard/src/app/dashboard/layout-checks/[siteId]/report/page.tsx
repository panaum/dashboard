import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import type { DpReport } from "@/lib/devicepreview/history";
import { ReportBody } from "@/components/layout-checks/report-body";
import { ShareReportLink } from "@/components/layout-checks/share-report-link";

export const metadata = { title: "Layout check report" };

// THE REPORT, for the team: the shared body with a way back, a way into the
// full check, and the control that mints a link a client can open.

export default async function LayoutReportPage({ params }: { params: Promise<{ siteId: string }> }) {
  await requireAuth();
  const { siteId } = await params;

  const site = await db.layoutSite.findUnique({
    where: { id: siteId },
    include: { devicePreviews: { orderBy: { checkedAt: "desc" }, take: 1 } },
  });
  if (!site) notFound();
  const run = site.devicePreviews[0] ? { id: site.devicePreviews[0].id, checkedAt: site.devicePreviews[0].checkedAt, report: site.devicePreviews[0].report as unknown as DpReport } : null;

  return (
    <ReportBody
      site={site}
      run={run}
      shotUrl={(profileId) => `/api/devicepreview/shot?runId=${run?.id ?? ""}&profile=${encodeURIComponent(profileId)}`}
      backHref={`/dashboard/layout-checks/${siteId}`}
      openHref={`/dashboard/layout-checks/${siteId}`}
    >
      {run && <ShareReportLink runId={run.id} />}
    </ReportBody>
  );
}
