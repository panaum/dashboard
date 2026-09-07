"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Check, Columns3, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { CheckShell } from "@/components/layout-checks/check-shell";
import { DeviceFrame } from "@/components/layout-checks/device-frame";
import { FindingsRail } from "@/components/layout-checks/findings-rail";
import { railItems } from "@/lib/layout-checks/findings-view";
import { comparableEngines, engineColumns } from "@/lib/layout-checks/engines-view";
import { DevicePreviewRunner } from "@/components/layout-checks/device-preview-runner";
import {
  IDLE_PROGRESS, isBusy, progressNote, progressPct, type DeviceRunState, type RunProgress,
} from "@/lib/layout-checks/run-progress";
import type { TabVerdict } from "@/lib/layout-checks/verdict";
import {
  defaultSelection, groupDevices, toView, type DeviceInput, type DeviceView, type Severity,
} from "@/lib/layout-checks/devices-view";

// The Devices tab: pick one device, see that device. The picker carries a
// severity dot (red: errors, amber: warnings only, nothing when clean) and an
// engine tag on every device, sorted worst first within Apple / Android /
// Tablet / Desktop, with the worst one selected on load — so the broken ones
// are found without clicking through all fourteen.

const DOT: Record<Severity, string> = {
  error: "bg-error", warning: "bg-warning", clean: "", inconclusive: "border border-text-muted bg-transparent",
};

export function DevicesPanel({
  verdict,
  runId,
  devices,
  storedFolds,
  liveAvailable,
  headerAction,
  run,
  url,
}: {
  verdict: TabVerdict;
  runId: string | null;
  devices: DeviceInput[];
  storedFolds: string[];
  /** The preview service is configured, so full-page images may still be served live. */
  liveAvailable: boolean;
  /** Shown beside the verdict when there is no run control to put there. */
  headerAction?: ReactNode;
  /** Present when the preview service is configured: the panel hosts the runner. */
  run?: { baselineServiceRunId: string | null; hasRuns: boolean };
  url: string;
}) {
  // A run in flight, drawn over the picker: every device grey, each one
  // fading to what the service actually reported for it. The severity dots
  // belong to the last saved run, so they step aside until this one is saved
  // rather than sitting there stale next to a device being re-captured.
  const [progress, setProgress] = useState<RunProgress>(IDLE_PROGRESS);
  const running = isBusy(progress);
  const note = progressNote(progress);

  const views = useMemo(() => devices.map(toView), [devices]);
  const groups = useMemo(() => groupDevices(views), [views]);
  const [selected, setSelected] = useState<string | null>(() => defaultSelection(views));
  const current: DeviceView | undefined = views.find((v) => v.profileId === selected) ?? views[0];
  const stored = new Set(storedFolds);

  // Rail state is per device: a new device means no selected finding, the
  // list folded back to five, and no assumptions about the image until it loads.
  const [finding, setFinding] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [imageMeta, setImageMeta] = useState<{ cssHeight: number } | null>(null);
  // The selection belongs to the device; expanded/collapsed is a density
  // preference and survives the switch.
  const pick = (profileId: string) => { setSelected(profileId); setFinding(null); setImageMeta(null); setColMeta({}); };
  const currentRaw = devices.find((d) => d.profile_id === current?.profileId);
  const items = useMemo(() => railItems(currentRaw?.findings ?? []), [currentRaw]);
  const selectedItem = items.find((i) => i.id === finding) ?? null;

  // Engine comparison: desktop only, where the three engines rendered the
  // same width. The toggle is offered nowhere else — there is no Firefox
  // iPhone to compare against. Entering or leaving it crossfades like a
  // selection change; the frames mount fresh and fade in.
  const cols = useMemo(() => (current ? comparableEngines(devices, current.profileId) : []), [devices, current]);
  const canCompare = cols.length >= 2;
  const [compare, setCompare] = useState(false);
  const [colMeta, setColMeta] = useState<Record<string, number | null>>({});
  const columns = useMemo(() => (compare && canCompare ? engineColumns(cols) : []), [compare, canCompare, cols]);
  const compareId = (engine: string, id: string) => `${engine}:${id}`;
  const selectedCol = finding && finding.includes(":") ? finding.split(":")[0] : null;
  const selectedColItem = selectedCol ? columns.find((c) => c.engine === selectedCol)?.items.find((i) => compareId(selectedCol, i.id) === finding) ?? null : null;
  const showCompare = compare && canCompare;
  // "Desktop 1440 (Firefox)" names one pill; a compared frame is the viewport
  // plus its own engine, so the pill's engine must not leak into every caption.
  const viewportName = current ? current.label.replace(/\s*\([^)]*\)\s*$/, "") : "";

  // Try the live full page only where it can exist; a request the page knows
  // will fail is a blank frame for as long as it takes to fail.
  const live = current && runId && liveAvailable ? `/api/devicepreview/live?runId=${runId}&profile=${encodeURIComponent(current.profileId)}&kind=full` : null;
  const fold = current && runId && stored.has(current.profileId) ? `/api/devicepreview/shot?runId=${runId}&profile=${encodeURIComponent(current.profileId)}` : null;

  const runLine = running || progress.phase === "failed" ? (
    <div className="flex flex-col gap-1.5" role="status" aria-live="polite">
      <p className={cn("text-[12.5px]", progress.phase === "failed" ? "text-error" : "text-text-muted")}>{note}</p>
      {running && (
        <div className="h-1 w-full max-w-sm overflow-hidden rounded-full bg-card-soft">
          <div className="h-full rounded-full bg-accent transition-[width] duration-500"
               style={{ width: `${Math.max(4, progressPct(progress))}%` }} />
        </div>
      )}
    </div>
  ) : null;

  const pills = views.length ? (
    <div className="flex flex-wrap gap-x-7 gap-y-3" role="group" aria-label="Devices">
      {groups.map(({ group, devices: ds }) => (
        <div key={group} className="flex flex-col gap-1.5">
          <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-text-muted">{group}</span>
          <div className="flex flex-wrap gap-1.5">
            {ds.map((d) => {
              const on = d.profileId === current?.profileId;
              const runState: DeviceRunState | null = running ? progress.devices[d.label] ?? "waiting" : null;
              return (
                <button
                  key={d.profileId}
                  type="button"
                  aria-pressed={on}
                  onClick={() => pick(d.profileId)}
                  title={`${d.label} · ${d.engineLabel} · ${d.viewportLabel}`}
                  className={cn(
                    "group flex flex-col items-start rounded-lg px-2.5 py-1.5 text-left transition-[opacity,color,background-color,border-color] duration-300 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent",
                    on ? "bg-accent text-text-on-dark" : "border border-border-soft bg-card text-text-primary hover:border-accent/50",
                    runState === "waiting" && "opacity-55",
                  )}
                >
                  <span className="flex items-center gap-1.5 text-[13px] font-medium leading-tight">
                    {runState ? (
                      runState === "captured" ? (
                        <Check aria-hidden className={cn("size-3 shrink-0 transition-colors duration-300", on ? "text-text-on-dark" : "text-text-secondary")} />
                      ) : (
                        <span aria-hidden className={cn(
                          "inline-block size-2 shrink-0 rounded-full transition-colors duration-300",
                          runState === "failed" ? "bg-error" : "bg-border-soft",
                        )} />
                      )
                    ) : d.severity !== "clean" ? (
                      <span aria-hidden className={cn("inline-block size-2 shrink-0 rounded-full", DOT[d.severity])} />
                    ) : null}
                    <span className="sr-only">
                      {runState === "captured" ? "captured: "
                        : runState === "failed" ? "capture failed: "
                        : runState === "waiting" ? "waiting: "
                        : d.severity === "error" ? "has errors: "
                        : d.severity === "warning" ? "has warnings: "
                        : d.severity === "inconclusive" ? "not captured: " : ""}
                    </span>
                    {d.label}
                  </span>
                  <span className={cn("flex items-center gap-1.5 text-[10.5px] tabular-nums", on ? "text-text-on-dark/75" : "text-text-muted")}>
                    {d.viewportLabel}
                    <span className={cn("rounded px-1 py-px text-[9.5px] font-semibold uppercase tracking-wide", on ? "bg-white/15" : "bg-card-soft")}>{d.engineLabel}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  ) : (
    <p className="text-[13px] text-text-muted">
      {running ? "The first run has no devices to list yet." : "Run the check to see it here."}
    </p>
  );

  const picker = (
    <div className="flex flex-col gap-3">
      {runLine}
      {pills}
    </div>
  );

  const srcFor = (profileId: string) => ({
    live: runId && liveAvailable ? `/api/devicepreview/live?runId=${runId}&profile=${encodeURIComponent(profileId)}&kind=full` : null,
    fold: runId && stored.has(profileId) ? `/api/devicepreview/shot?runId=${runId}&profile=${encodeURIComponent(profileId)}` : null,
  });

  const toggle = current && canCompare ? (
    <div className="flex w-full justify-center">
      <button
        type="button"
        aria-pressed={showCompare}
        onClick={() => { setCompare((c) => !c); setFinding(null); }}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[12.5px] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent",
          showCompare ? "border-accent bg-accent/10 text-accent" : "border-border-soft bg-card text-text-secondary hover:border-accent/50 hover:text-text-primary",
        )}
      >
        <Columns3 className="size-3.5" /> Compare engines
      </button>
    </div>
  ) : null;

  const frame = current && showCompare ? (
    <Fade key="compare" className="flex w-full flex-col items-center gap-3">
      {toggle}
      <div className="grid w-full gap-3 md:grid-cols-3">
        {columns.map((c) => {
          const s = srcFor(c.profileId);
          const hl = selectedColItem && selectedCol === c.engine ? selectedColItem.box : null;
          return (
            <div key={c.profileId} className="flex min-w-0 flex-col items-center gap-1.5">
              <DeviceFrame
                shape="desktop"
                viewport={current.viewport}
                src={s.live ?? s.fold}
                fallbackSrc={s.fold}
                alt={`${viewportName} at ${current.viewportLabel}, rendered by ${c.engineLabel}`}
                title={url.replace(/^https?:\/\//, "")}
                maxHeight={360}
                highlight={hl}
                onImageMeta={(m) => setColMeta((prev) => ({ ...prev, [c.engine]: m?.cssHeight ?? null }))}
              />
              <p className="text-[12px] text-text-muted">
                <span className="font-medium text-text-secondary">{c.engineLabel}</span>
                {" · "}{c.status !== "ok" ? c.status : `${c.errors} error${c.errors === 1 ? "" : "s"} · ${c.warnings} warning${c.warnings === 1 ? "" : "s"}`}
              </p>
            </div>
          );
        })}
      </div>
    </Fade>
  ) : current ? (
    <Fade key="single" className="flex w-full flex-col items-center gap-2.5">
      {toggle}
      <DeviceFrame
        shape={current.shape}
        viewport={current.viewport}
        src={live ?? fold}
        fallbackSrc={fold}
        alt={`${current.label}, rendered page`}
        title={url.replace(/^https?:\/\//, "")}
        highlight={selectedItem?.box ?? null}
        onImageMeta={setImageMeta}
      />
      <p className="text-[12px] text-text-muted">
        <span className="font-medium text-text-secondary">{current.label}</span>
        {" · "}{current.engineLabel}{" · "}{current.viewportLabel}
      </p>
    </Fade>
  ) : null;

  // Your browser, not the device's: the live page in a window of the
  // profile's viewport size. Honest about what it is, in the tooltip.
  const openAtSize = current ? (
    <Button
      type="button"
      variant="secondary"
      size="sm"
      onClick={() => window.open(url, "_blank", `width=${current.viewport.width},height=${current.viewport.height}`)}
      title="Opens the live page in your own browser at this size — your browser, not the device's."
    >
      <ExternalLink className="size-4" /> Open at this size
    </Button>
  ) : null;

  const rail = current && showCompare ? (
    <div className="flex flex-col gap-4">
      {columns.map((c) => (
        <FindingsRail
          key={c.profileId}
          deviceLabel={c.engineLabel}
          heading={
            <p className="mb-1 flex items-baseline gap-2 text-[11px] font-semibold uppercase tracking-[0.07em] text-text-muted">
              {c.engineLabel}
              <span className="font-medium normal-case tracking-normal text-text-muted/80">
                {c.errors + c.warnings > 0
                  ? `${c.errors + c.warnings} finding${c.errors + c.warnings === 1 ? "" : "s"}`
                  : c.items.length > 0 ? `${c.items.length} note${c.items.length === 1 ? "" : "s"}` : "clean"}
              </span>
            </p>
          }
          items={c.items.map((it) => ({ ...it, id: compareId(c.engine, it.id), tag: it.onlyHere ? `only in ${c.engineLabel}` : undefined }))}
          selectedId={finding}
          onSelect={(id) => setFinding((cur) => (cur === id ? null : id))}
          expanded={expanded}
          onToggle={() => setExpanded((e) => !e)}
          drawableHeight={colMeta[c.engine] ?? null}
        />
      ))}
    </div>
  ) : current ? (
    current.status !== "ok" ? (
      <p className="text-[13px] text-text-secondary">
        {current.status === "blocked" ? "Blocked by bot protection — nothing on this device was audited." : `Capture failed${current.error ? `: ${current.error}` : "."}`}
      </p>
    ) : (
      <FindingsRail
        deviceLabel={current.label}
        items={items}
        selectedId={finding}
        onSelect={(id) => setFinding((cur) => (cur === id ? null : id))}
        expanded={expanded}
        onToggle={() => setExpanded((e) => !e)}
        drawableHeight={imageMeta?.cssHeight ?? null}
      />
    )
  ) : (
    <p className="text-[13px] text-text-muted">No run yet.</p>
  );

  return (
    <CheckShell
      verdict={verdict}
      headerAction={run
        ? <DevicePreviewRunner url={url} baselineServiceRunId={run.baselineServiceRunId} hasRuns={run.hasRuns} onProgress={setProgress} />
        : headerAction}
      picker={picker}
      frame={frame}
      action={openAtSize}
      rail={rail}
      railLabel={current ? (showCompare ? `Findings by engine at ${current.viewportLabel}` : `Findings on ${current.label}`) : "Findings"}
    />
  );
}

// Mounts transparent and fades in over 150ms — the same crossfade a
// selection change gets, reused for entering and leaving comparison.
function Fade({ className, children }: { className?: string; children: ReactNode }) {
  const [on, setOn] = useState(false);
  useEffect(() => { const id = requestAnimationFrame(() => setOn(true)); return () => cancelAnimationFrame(id); }, []);
  return <div className={className} style={{ opacity: on ? 1 : 0, transition: "opacity 150ms ease" }}>{children}</div>;
}
