import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { db } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { PageHeader } from "@/components/shared/page-header";
import { CheckRunner } from "@/components/layout-checks/check-runner";
import { DevicePreviewRunner } from "@/components/layout-checks/device-preview-runner";
import { SiteTabs } from "@/components/layout-checks/site-tabs";
import { CheckShell } from "@/components/layout-checks/check-shell";
import { devicePreviewConfigured } from "@/lib/devicepreview/client";
import type { DpReport } from "@/lib/devicepreview/history";
import { devicesVerdict, viewportsVerdict } from "@/lib/layout-checks/verdict";
import type { ResponsiveFinding } from "@/lib/linkspy/responsive-view";

export const metadata = { title: "Layout checks" };

// One screenshot and the findings for that screenshot, nothing else. Two
// tabs — the eight-width sweep and the device-matrix run — share one layout
// (CheckShell) so the interaction is learned once. Step 1 of the redesign:
// the tab structure, the verdict lines, and the shell with a placeholder
// picker and rail; the pickers, frames and rail arrive in the next steps.

const PLATFORM_LABEL: Record<string, string> = {
  ios: "Apple", ipados: "Tablet", android: "Android", desktop: "Desktop",
};

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
        take: 2,
        include: { shots: { select: { width: true }, orderBy: { width: "asc" } } },
      },
      devicePreviews: {
        orderBy: { checkedAt: "desc" },
        take: 2,
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
      action={<CheckRunner url={site.url} label={vCur ? "Run again" : "Run the eight-width check"} />}
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
  const dShots = new Set(dCur?.shots.map((s) => s.profileId) ?? []);
  const firstDevice = dReport?.devices[0];
  const grouped = new Map<string, DpReport["devices"]>();
  for (const d of dReport?.devices ?? []) {
    const list = grouped.get(d.platform) ?? [];
    list.push(d);
    grouped.set(d.platform, list);
  }
  const groups = Array.from(grouped);

  const devicesPanel = (
    <CheckShell
      verdict={dVerdict}
      picker={
        dReport ? (
          <div className="flex flex-wrap gap-x-6 gap-y-3" aria-label="Devices">
            {groups.map(([platform, devs]) => (
              <div key={platform} className="flex flex-col gap-1.5">
                <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-text-muted">{PLATFORM_LABEL[platform] ?? platform}</span>
                <div className="flex flex-wrap gap-1.5">
                  {devs.map((d) => (
                    <span key={d.profile_id} className={d.profile_id === firstDevice?.profile_id
                      ? "rounded-full bg-accent px-3 py-1 text-[13px] font-medium text-text-on-dark"
                      : "rounded-full border border-border-soft px-3 py-1 text-[13px] text-text-secondary"}>
                      {d.label}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-[13px] text-text-muted">Run the check to see it here.</p>
        )
      }
      frame={
        dCur && firstDevice && dShots.has(firstDevice.profile_id) ? (
          <div className="w-full max-w-[420px] overflow-hidden rounded-xl border border-border-soft bg-card-soft">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`/api/devicepreview/shot?runId=${dCur.id}&profile=${encodeURIComponent(firstDevice.profile_id)}`}
                 alt={`${firstDevice.label}, above the fold`} className="block max-h-[640px] w-full object-cover object-top" />
          </div>
        ) : null
      }
      action={devicePreviewConfigured()
        ? <DevicePreviewRunner url={site.url} baselineServiceRunId={dCur?.serviceRunId ?? null} hasRuns={Boolean(dCur)} />
        : <p className="text-[12px] text-text-muted">Device preview is not configured on this deployment.</p>}
      rail={
        <p className="text-[13px] text-text-muted">
          {dCur ? "Findings for the selected device will appear here." : "No run yet."}
        </p>
      }
      railLabel="Findings on the selected device"
    />
  );

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
    </>
  );
}
