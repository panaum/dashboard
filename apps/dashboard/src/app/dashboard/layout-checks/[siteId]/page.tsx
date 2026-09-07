import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { db } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { PageHeader } from "@/components/shared/page-header";
import { CheckRunner } from "@/components/layout-checks/check-runner";
import { SiteTabs } from "@/components/layout-checks/site-tabs";
import { CheckShell } from "@/components/layout-checks/check-shell";
import { DevicesPanel } from "@/components/layout-checks/devices-panel";
import { RunHistory, type HistoryRow } from "@/components/layout-checks/run-history";
import type { DeviceInput } from "@/lib/layout-checks/devices-view";
import { devicePreviewConfigured } from "@/lib/devicepreview/client";
import type { DpReport } from "@/lib/devicepreview/history";
import { devicesVerdict, viewportsVerdict } from "@/lib/layout-checks/verdict";
import type { ResponsiveFinding } from "@/lib/linkspy/responsive-view";

export const metadata = { title: "Layout checks" };

// One screenshot and the findings for that screenshot, nothing else. Two
// tabs — the eight-width sweep and the device-matrix run — share one layout
// (CheckShell) so the interaction is learned once. Steps 1–2 of the
// redesign: tabs, verdict lines, the shell; and on the Devices tab the real
// picker (severity dots, engine tags, worst first) and the resizing frame.
// The findings rail is still a placeholder (step 3).

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
    <CheckShell
      verdict={vVerdict}
      picker={
        vCur ? (
          <div className="flex flex-wrap gap-2" aria-label="Widths">
            {widths.map((w, i) => (
              <span key={w} className={i === 0
                ? "rounded-full bg-accent px-3 py-1 text-[13px] font-medium text-text-on-dark"
                : "rounded-full border border-border-soft px-3 py-1 text-[13px] text-text-secondary"}>
                {w}
              </span>
            ))}
          </div>
        ) : (
          <p className="text-[13px] text-text-muted">Run the check to see it here.</p>
        )
      }
      frame={
        vCur && widths.length ? (
          <div className="w-full max-w-[420px] overflow-hidden rounded-xl border border-border-soft bg-card-soft">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`/api/layout-shot?runId=${vCur.id}&width=${widths[0]}`} alt={`Rendered at ${widths[0]} pixels wide`}
                 className="block max-h-[640px] w-full object-cover object-top" />
          </div>
        ) : null
      }
      headerAction={<CheckRunner url={site.url} label={vCur ? "Run again" : "Run the eight-width check"} />}
      rail={
        <p className="text-[13px] text-text-muted">
          {vCur ? "Findings for the selected width will appear here." : "No run yet."}
        </p>
      }
      railLabel="Findings at the selected width"
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
      run={devicePreviewConfigured()
        ? { baselineServiceRunId: dCur?.serviceRunId ?? null, hasRuns: Boolean(dCur) }
        : undefined}
      headerAction={<p className="text-[12px] text-text-muted">Device preview is not configured on this deployment.</p>}
    />
  );

  // ── History: run-level, so it sits below the tabs, not beside a screenshot ──
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

  return (
    <>
      <Link href="/dashboard/layout-checks"
            className="mb-3 inline-flex items-center gap-1.5 text-[13px] text-text-secondary hover:text-text-primary">
        <ArrowLeft className="size-3.5" /> All layout checks
      </Link>

      <PageHeader
        title={site.label ?? site.url.replace(/^https?:\/\//, "")}
        subtitle={site.url}
        action={
          <a href={site.url} target="_blank" rel="noopener"
             className="inline-flex items-center gap-2 text-[13px] text-text-secondary hover:text-text-primary">
            Open the page <ExternalLink className="size-3.5" />
          </a>
        }
      />

      <SiteTabs
        panels={{ viewports: viewportsPanel, devices: devicesPanel }}
        explainFor={{ viewports: !vCur, devices: !dCur }}
        initial={vCur || !dCur ? "viewports" : "devices"}
      />

      <div className="mt-8">
        <RunHistory rows={history} />
      </div>
    </>
  );
}
