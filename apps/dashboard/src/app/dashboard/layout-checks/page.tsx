import { db } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { PageHeader } from "@/components/shared/page-header";
import { Card } from "@/components/ui/card";
import { AddSiteForm } from "@/components/layout-checks/add-site-form";
import { PagesList } from "@/components/layout-checks/pages-list";
import type { ListRow, Thumb } from "@/lib/layout-checks/list-view";

export const metadata = { title: "Layout checks" };

// The pages we watch, worst first. Each row carries both checks — the
// eight-width sweep and the device matrix — because a page is only as good as
// its worse half, and a reader should not have to open two places to find that
// out. Sorting, searching and running live in the list itself (PagesList).

export default async function LayoutChecksPage() {
  await requireAuth();

  const sites = await db.layoutSite.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      runs: {
        orderBy: { checkedAt: "desc" },
        take: 1,
        // The narrowest stored width makes the best thumbnail: it is the shape
        // of a phone, which is what the reader is worried about.
        include: { shots: { select: { width: true }, orderBy: { width: "asc" }, take: 1 } },
      },
      devicePreviews: {
        orderBy: { checkedAt: "desc" },
        take: 1,
        include: { shots: { select: { profileId: true }, take: 1 } },
      },
    },
  });

  const rows: ListRow[] = sites.map((s) => {
    const v = s.runs[0];
    const d = s.devicePreviews[0];
    const thumb: Thumb =
      v && v.shots[0] ? { kind: "width", runId: v.id, width: v.shots[0].width }
      : d && d.shots[0] ? { kind: "device", runId: d.id, profile: d.shots[0].profileId }
      : null;
    return {
      id: s.id,
      url: s.url,
      label: s.label,
      viewports: v
        ? { checkedAt: v.checkedAt.toISOString(), worst: v.worst, failCount: v.failCount, warnCount: v.warnCount }
        : null,
      devices: d
        ? { checkedAt: d.checkedAt.toISOString(), worst: d.worst, errorCount: d.errorCount,
            warnCount: d.warnCount, deviceCount: d.deviceCount }
        : null,
      thumb,
    };
  });

  return (
    <>
      <PageHeader
        title="Layout checks"
        subtitle="Pages rendered at eight widths and across the device matrix, with every run kept — so you can prove what changed."
      />

      <Card className="mb-5 px-5 py-4">
        <AddSiteForm />
      </Card>

      {rows.length === 0 ? (
        <Card className="px-6 py-10">
          <div className="mx-auto flex max-w-md flex-col gap-3 text-center">
            <p className="text-sm font-medium text-text-primary">Nothing is being watched yet.</p>
            <p className="text-[13px] leading-relaxed text-text-secondary">
              Add a client page above and run a check. The eight-width sweep takes about a
              minute and a half; the device matrix renders it on fourteen real device
              profiles across three browser engines.
            </p>
            <p className="text-[12.5px] leading-relaxed text-text-muted">
              You can also run the width sweep from a site&apos;s Layout tab under Sites —
              add the page here and the run is kept, with its screenshots and history.
            </p>
          </div>
        </Card>
      ) : (
        <PagesList rows={rows} />
      )}
    </>
  );
}
