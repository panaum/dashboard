import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ExternalLink, FileText } from "lucide-react";
import { db } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { CheckRunner } from "@/components/layout-checks/check-runner";
import { SiteTabs } from "@/components/layout-checks/site-tabs";
import { ViewportsPanel } from "@/components/layout-checks/viewports-panel";
import { DevicesPanel } from "@/components/layout-checks/devices-panel";
import { RunsMenu, type HistoryRow } from "@/components/layout-checks/runs-menu";
import type { DeviceInput } from "@/lib/layout-checks/devices-view";
import { devicePreviewConfigured } from "@/lib/devicepreview/client";
import type { DpReport } from "@/lib/devicepreview/history";
import { devicesVerdict, viewportsVerdict } from "@/lib/layout-checks/verdict";
import type { ResponsiveFinding } from "@/lib/linkspy/responsive-view";
import type { ViewportFinding } from "@/lib/layout-checks/viewports-view";

export const metadata = { title: "Layout checks" };

// One screenshot and the findings for that screenshot, nothing else. Two
// tabs — the eight-width sweep and the device-matrix run — share one stage
// (CheckShell) so the interaction is learned once: a tinted verdict, a
// dropdown and an at-a-glance strip of every device, the device large on a
// dark stage, and the findings for that ONE screenshot beside it. Run
// history is a menu beside the tabs.

export default async function LayoutSitePage({
  params,
}: {
  params: Promise<{ siteId: string }>;
}) {
  await requireAuth();
  const { siteId } = await params;

  const site = await db.layoutSite.findUnique({
    where: { id: siteId },
    include: {
      runs: {
        orderBy: { checkedAt: "desc" },
        take: 12,
        include: { shots: { select: { width: true }, orderBy: { width: "asc" } } },
      },
      devicePreviews: {
        orderBy: { checkedAt: "desc" },
        take: 12,
        include: { shots: { select: { profileId: true } } },
      },
    },
  });
  if (!site) notFound();

  // ── Viewports ────────────────────────────────────────────────────────────
  const [vCur, vPrev] = site.runs;
  const asViewportsRun = (r: typeof vCur | undefined) => r
    ? { findings: r.findings as unknown as ResponsiveFinding[], widths: r.shots.map((s) => s.width), checkedAt: r.checkedAt.toISOString() }
    : null;
  const vVerdict = viewportsVerdict(asViewportsRun(vCur), asViewportsRun(vPrev));
  const widths = vCur?.shots.map((s) => s.width) ?? [];

  const viewportsPanel = (
    <ViewportsPanel
      verdict={vVerdict}
      runId={vCur?.id ?? null}
      findings={(vCur?.findings ?? []) as unknown as ViewportFinding[]}
      widths={widths}
      url={site.url}
      trend={site.runs.map((r) => ({ checkedAt: r.checkedAt.toISOString(), errors: r.failCount }))}
      headerAction={<CheckRunner url={site.url} variant="secondary" size="sm" label={vCur ? "Run again" : "Run the eight-width check"} />}
    />
  );

  // ── Devices ──────────────────────────────────────────────────────────────
  const [dCur, dPrev] = site.devicePreviews;
  const asDevicesRun = (r: typeof dCur | undefined) => r
    ? { report: r.report as unknown as DpReport, checkedAt: r.checkedAt.toISOString() } : null;
  const dVerdict = devicesVerdict(asDevicesRun(dCur), asDevicesRun(dPrev));
  const dReport = dCur ? (dCur.report as unknown as DpReport) : null;
  const deviceInputs: DeviceInput[] = (dReport?.devices ?? []).map((d) => ({
    ...(d as DeviceInput),
    findings: d.findings ?? [],
  }));

  const devicesPanel = (
    <DevicesPanel
      verdict={dVerdict}
      runId={dCur?.id ?? null}
      devices={deviceInputs}
      storedFolds={dCur?.shots.map((s) => s.profileId) ?? []}
      liveAvailable={devicePreviewConfigured()}
      url={site.url}
      trend={site.devicePreviews.map((r) => ({ checkedAt: r.checkedAt.toISOString(), errors: r.errorCount + r.regressedCount }))}
      run={devicePreviewConfigured()
        ? { baselineServiceRunId: dCur?.serviceRunId ?? null, hasRuns: Boolean(dCur) }
        : undefined}
      headerAction={<p className="text-[12px] text-text-muted">Device preview is not configured on this deployment.</p>}
    />
  );

  // ── History: run-level, so it lives with the tabs, not beside a screenshot ──
  // The preview service keeps full pages for the newest DEVICE_FULL_PAGES_KEPT
  // runs of a site (its RETAIN_PER_SITE, default 2); the Dashboard keeps folds
  // for as many. Older rows say so before anyone clicks in.
  const DEVICE_FULL_PAGES_KEPT = 2;
  const history: HistoryRow[] = [
    ...site.runs.map((r) => ({
      id: r.id, kind: "Viewports" as const, checkedAt: r.checkedAt.toISOString(), worst: r.worst,
      summary: `${r.failCount} failing · ${r.warnCount} to look at`,
      kept: (r.shots.length > 0 ? "all" : "none") as HistoryRow["kept"],
    })),
    ...site.devicePreviews.map((r, i) => ({
      id: r.id, kind: "Devices" as const, checkedAt: r.checkedAt.toISOString(), worst: r.worst,
      summary: `${r.deviceCount} devices · ${r.errorCount} error${r.errorCount === 1 ? "" : "s"} · ${r.warnCount} warning${r.warnCount === 1 ? "" : "s"}${r.regressedCount ? ` · ${r.regressedCount} regressed` : ""}`,
      kept: (i < DEVICE_FULL_PAGES_KEPT ? "all" : r.shots.length > 0 ? "folds" : "none") as HistoryRow["kept"],
    })),
  ].sort((a, b) => b.checkedAt.localeCompare(a.checkedAt)).slice(0, 12);

  const title = site.label ?? site.url.replace(/^https?:\/\//, "").replace(/\/$/, "");

  return (
    // data-wide: the stage wants the room; the shared layout widens its container for it.
    <div className="flex flex-col gap-6" data-wide="">
      <div className="flex flex-col gap-3">
        <Link href="/dashboard/layout-checks"
              className="inline-flex w-fit items-center gap-1.5 text-[13px] text-text-secondary transition-colors hover:text-text-primary">
          <ArrowLeft className="size-3.5" /> All layout checks
        </Link>
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
          <div className="min-w-0">
            <h1 className="truncate text-[30px] font-semibold leading-tight tracking-tight text-text-primary">{title}</h1>
            <a href={site.url} target="_blank" rel="noopener"
               className="mt-1 inline-flex max-w-full items-center gap-1.5 truncate font-mono text-[12.5px] text-text-secondary transition-colors hover:text-accent">
              <span className="truncate">{site.url}</span>
              <ExternalLink className="size-3.5 shrink-0" />
            </a>
          </div>
          <Link href={`/dashboard/layout-checks/${siteId}/report`}
                className="inline-flex items-center gap-2 rounded-full border border-border-soft bg-card px-4 py-2 text-[13px] font-medium text-text-primary shadow-xs transition-colors hover:bg-card-soft">
            <FileText className="size-4" /> Client report
          </Link>
        </div>
      </div>

      <SiteTabs
        panels={{ viewports: viewportsPanel, devices: devicesPanel }}
        explainFor={{ viewports: !vCur, devices: !dCur }}
        initial={vCur || !dCur ? "viewports" : "devices"}
        right={<RunsMenu rows={history} />}
      />
    </div>
  );
}
