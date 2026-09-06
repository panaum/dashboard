import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { DevicePreviewRunner } from "@/components/layout-checks/device-preview-runner";
import {
  countsOf, deltaLine, deltaOf, deviceRows, verdictLine, WORST_TONE, type DpReport, type Worst,
} from "@/lib/devicepreview/history";

// The "Device preview" section of a Layout checks page: how this page renders
// across the device matrix, run by run. The gallery itself is the service's
// own report.html, embedded while the service still keeps that run; what the
// Dashboard keeps forever is the report and a fold JPEG per device.

type RunRow = {
  id: string;
  checkedAt: Date;
  serviceRunId: string;
  report: unknown;
  worst: string;
  deviceCount: number;
  errorCount: number;
  warnCount: number;
  regressedCount: number;
  shots: { profileId: string }[];
};

const ENGINE = { webkit: "WebKit", chromium: "Chromium", firefox: "Firefox" } as Record<string, string>;

export function DevicePreviewSection({ url, runs, configured }: { url: string; runs: RunRow[]; configured: boolean }) {
  const [current, previous] = runs;
  const report = current ? (current.report as DpReport) : null;
  const counts = report ? countsOf(report) : null;
  const prevCounts = previous ? countsOf(previous.report as DpReport) : null;
  const rows = report ? deviceRows(report) : [];
  const shotFor = new Set(current?.shots.map((s) => s.profileId) ?? []);

  return (
    <Card>
      <CardHeader className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <CardTitle>Device preview</CardTitle>
          <p className="mt-1 text-[12px] text-text-muted">
            The page rendered on iPhones, iPads, Android phones and tablets, and desktop Chrome, Firefox and Safari — real browser engines, emulated devices.
          </p>
        </div>
        {configured ? (
          <DevicePreviewRunner url={url} baselineServiceRunId={current?.serviceRunId ?? null} hasRuns={Boolean(current)} />
        ) : (
          <p className="text-[12px] text-text-muted">Not configured on this deployment (DEVICEPREVIEW_URL).</p>
        )}
      </CardHeader>

      {!current || !report || !counts ? (
        <p className="px-5 pb-6 text-sm text-text-secondary">
          No previews yet. Run one to see this page on fifteen devices and keep the result.
        </p>
      ) : (
        <div className="flex flex-col gap-5 px-5 pb-5">
          <div className="flex flex-wrap items-center gap-3">
            <Badge tone={WORST_TONE[counts.worst as Worst]}>{counts.worst}</Badge>
            <span className="text-[15px] font-medium text-text-primary">{verdictLine(counts, report)}</span>
            <span className="text-[12px] text-text-muted">{deltaLine(deltaOf(prevCounts, counts))}</span>
            <span className="ml-auto text-[12px] text-text-muted">{current.checkedAt.toLocaleString()}</span>
          </div>

          <iframe
            src={`/api/devicepreview/view/${current.id}/report.html`}
            title="Device preview gallery"
            loading="lazy"
            className="h-[880px] w-full rounded-lg border border-border-soft bg-card-soft"
          />

          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-text-muted">
                  <th className="py-1.5 pr-3 font-medium">Device</th>
                  <th className="py-1.5 pr-3 font-medium">Engine</th>
                  <th className="py-1.5 pr-3 font-medium">Result</th>
                  <th className="py-1.5 pr-3 font-medium">Worst finding</th>
                  <th className="py-1.5 font-medium">Fold</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-soft">
                {rows.map((r) => (
                  <tr key={r.profileId} className="align-top">
                    <td className="py-2 pr-3 font-medium text-text-primary">{r.label}</td>
                    <td className="py-2 pr-3 text-text-secondary">{ENGINE[r.engine] ?? r.engine}</td>
                    <td className="py-2 pr-3">
                      {r.status === "blocked" ? <Badge tone="neutral">blocked</Badge>
                        : r.status !== "ok" ? <Badge tone="neutral">failed</Badge>
                        : r.regressed ? <Badge tone="error">regressed {r.diffPercent?.toFixed(2)}%</Badge>
                        : r.errors ? <Badge tone="error">{r.errors} error{r.errors === 1 ? "" : "s"}</Badge>
                        : r.warnings ? <Badge tone="warning">{r.warnings} warning{r.warnings === 1 ? "" : "s"}</Badge>
                        : <Badge tone="success">clean</Badge>}
                    </td>
                    <td className="max-w-md py-2 pr-3 text-text-secondary">
                      {r.status !== "ok" ? r.error : r.worst ? <><span className="font-mono text-[11px] uppercase text-text-muted">{r.worst.rule}</span> {r.worst.message}</> : "—"}
                    </td>
                    <td className="py-2">
                      {shotFor.has(r.profileId) ? (
                        <a href={`/api/devicepreview/shot?runId=${current.id}&profile=${encodeURIComponent(r.profileId)}`} target="_blank" rel="noopener">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={`/api/devicepreview/shot?runId=${current.id}&profile=${encodeURIComponent(r.profileId)}`}
                               alt={`${r.label}, above the fold`} className="h-16 w-auto rounded border border-border-soft" />
                        </a>
                      ) : <span className="text-[11px] text-text-muted">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {runs.length > 1 && (
            <div>
              <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-text-muted">History</p>
              <div className="flex flex-col divide-y divide-border-soft">
                {runs.map((r) => (
                  <div key={r.id} className="flex flex-wrap items-center gap-3 py-2">
                    <span className="w-52 text-[13px] text-text-secondary">{r.checkedAt.toLocaleString()}</span>
                    <Badge tone={WORST_TONE[(r.worst as Worst) in WORST_TONE ? (r.worst as Worst) : "PASS"]}>{r.worst}</Badge>
                    <span className="text-[12px] text-text-muted">
                      {r.deviceCount} devices · {r.errorCount} error{r.errorCount === 1 ? "" : "s"} · {r.warnCount} warning{r.warnCount === 1 ? "" : "s"}
                      {r.regressedCount ? ` · ${r.regressedCount} regressed` : ""}
                    </span>
                    {r.shots.length === 0 && <span className="ml-auto text-[11px] text-text-muted">images pruned</span>}
                  </div>
                ))}
              </div>
            </div>
          )}
          <p className="text-[12px] text-text-muted">
            Fold screenshots are kept for the two most recent previews. The full gallery, with full-page images and the diff against the previous run, is served from the preview service while it keeps the run.
          </p>
        </div>
      )}
    </Card>
  );
}
