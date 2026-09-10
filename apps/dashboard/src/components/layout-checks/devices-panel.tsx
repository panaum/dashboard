"use client";

import { useMemo, useState, type ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Columns3, ExternalLink, Globe, Loader2, ShieldAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { Listbox, type ListOption, type ListTone } from "@/components/ui/listbox";
import { BarLabel, CheckShell, ON_STAGE, revealStage, StageBar, StageButton, StageCaption } from "@/components/layout-checks/check-shell";
import { DeviceFrame } from "@/components/layout-checks/device-frame";
import { FindingsRail } from "@/components/layout-checks/findings-rail";
import { Glance, type GlanceRow, type GlanceTone } from "@/components/layout-checks/glance";
import { railItems } from "@/lib/layout-checks/findings-view";
import { LIVE_CAVEAT, qaUrl } from "@/lib/layout-checks/embed";
import { LiveSession } from "@/components/layout-checks/live-session";
import { comparableEngines, engineColumns } from "@/lib/layout-checks/engines-view";
import { DevicePreviewRunner } from "@/components/layout-checks/device-preview-runner";
import {
  IDLE_PROGRESS, isBusy, progressNote, progressPct, type DeviceRunState, type RunProgress,
} from "@/lib/layout-checks/run-progress";
import type { TabVerdict } from "@/lib/layout-checks/verdict";
import {
  defaultSelection, groupDevices, toView,
  type DeviceInput, type DeviceView, type Severity,
} from "@/lib/layout-checks/devices-view";

// The Devices tab: pick one device, see that device. The picker is a dropdown
// grouped Apple / Android / Tablet / Desktop, worst first inside each group,
// with the worst one selected on load — and beside it a glance strip, one
// coloured cell per device, so all fourteen are read at once and any one is
// a click away. The device sits large on the dark stage; the bar under it
// holds compare, live and open; the findings run under the stage.

const TONE: Record<Severity, ListTone> = { error: "error", warning: "warning", clean: "success", inconclusive: "neutral" };
const CELL: Record<Severity, GlanceTone> = { error: "error", warning: "warning", clean: "success", inconclusive: "neutral" };
const RUN_CELL: Record<DeviceRunState, GlanceTone> = { waiting: "waiting", captured: "captured", failed: "error" };

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
  const reduce = useReducedMotion();
  // A run in flight, drawn over the glance strip: every device grey, each one
  // turning to what the service actually reported for it. The severities
  // belong to the last saved run, so they step aside until this one is saved.
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
  const pick = (profileId: string) => {
    setSelected(profileId); setFinding(null); setImageMeta(null); setColMeta({});
    setStreaming(false);            // the session is pinned to one profile
  };
  const currentRaw = devices.find((d) => d.profile_id === current?.profileId);
  const items = useMemo(() => railItems(currentRaw?.findings ?? []), [currentRaw]);
  const selectedItem = items.find((i) => i.id === finding) ?? null;

  // Engine comparison: desktop only, where the three engines rendered the
  // same width. The toggle is offered nowhere else — there is no Firefox
  // iPhone to compare against.
  const cols = useMemo(() => (current ? comparableEngines(devices, current.profileId) : []), [devices, current]);
  const canCompare = cols.length >= 2;
  const [compare, setCompare] = useState(false);
  const [colMeta, setColMeta] = useState<Record<string, number | null>>({});
  const columns = useMemo(() => (compare && canCompare ? engineColumns(cols) : []), [compare, canCompare, cols]);
  const compareId = (engine: string, id: string) => `${engine}:${id}`;
  const selectedCol = finding && finding.includes(":") ? finding.split(":")[0] : null;
  const selectedColItem = selectedCol ? columns.find((c) => c.engine === selectedCol)?.items.find((i) => compareId(selectedCol, i.id) === finding) ?? null : null;
  const showCompare = compare && canCompare;

  // The real page in the frame, for when a picture of it is not the question.
  // Asked for, never automatic: framing a client page is a real visit to it,
  // so it happens on a click and carries the same QA parameters the sweep
  // uses. The site decides whether it may be framed at all, and only the
  // server can find that out — a refused frame is opaque to script.
  const [live, setLive] = useState(false);
  const [embed, setEmbed] = useState<{ checking?: boolean; reason?: string } | null>(null);
  // Two ways to be "live", and the profile decides which you get. A Chromium
  // profile gets a real browser on the service — real touch, real user agent,
  // and it works on pages that refuse to be framed. Everything else falls back
  // to the iframe, which is your own browser at that width and says so.
  const canStream = current?.engine === "chromium";
  const [streaming, setStreaming] = useState(false);

  const goLive = async () => {
    if (streaming) { setStreaming(false); return; }
    if (live) { setLive(false); return; }
    if (canStream) { setStreaming(true); setFinding(null); return; }
    setEmbed({ checking: true });
    try {
      const v = await (await fetch(`/api/embed-check?url=${encodeURIComponent(url)}`, { cache: "no-store" })).json();
      if (v?.embeddable) { setEmbed(null); setLive(true); setFinding(null); }
      else setEmbed({ reason: v?.reason ?? "This page cannot be shown inside the Dashboard." });
    } catch {
      setEmbed({ reason: "Could not check whether this page can be framed." });
    }
  };
  const showLive = live && !showCompare;
  const showStream = streaming && !showCompare && Boolean(current);
  // "Desktop 1440 (Firefox)" names one device; a compared frame is the viewport
  // plus its own engine, so the device's engine must not leak into every caption.
  const viewportName = current ? current.label.replace(/\s*\([^)]*\)\s*$/, "") : "";

  // Try the live full page only where it can exist; a request the page knows
  // will fail is a blank frame for as long as it takes to fail.
  const srcFor = (profileId: string) => ({
    live: runId && liveAvailable ? `/api/devicepreview/live?runId=${runId}&profile=${encodeURIComponent(profileId)}&kind=full` : null,
    fold: runId && stored.has(profileId) ? `/api/devicepreview/shot?runId=${runId}&profile=${encodeURIComponent(profileId)}` : null,
  });
  const src = current ? srcFor(current.profileId) : { live: null, fold: null };

  // ── Picker: the dropdown, the glance strip, and the run line while a run is on ──
  const runState = (d: DeviceView): DeviceRunState | null => running ? progress.devices[d.label] ?? "waiting" : null;

  const options: ListOption[] = groups.flatMap(({ group, devices: ds }) => ds.map((d): ListOption => {
    const rs = runState(d);
    return {
      id: d.profileId,
      label: d.label,
      sub: `${d.engineLabel} · ${d.viewportLabel}${d.severity === "error" ? ` · ${d.errors} error${d.errors === 1 ? "" : "s"}` : d.severity === "warning" ? ` · ${d.warnings} warning${d.warnings === 1 ? "" : "s"}` : d.severity === "inconclusive" ? " · not captured" : ""}`,
      tone: rs ? (rs === "failed" ? "error" : rs === "captured" ? "info" : "neutral") : TONE[d.severity],
      group,
    };
  }));

  const glanceRows: GlanceRow[] = groups.map(({ group, devices: ds }) => ({
    name: group,
    cells: ds.map((d) => {
      const rs = runState(d);
      return {
        id: d.profileId,
        label: `${d.label} · ${d.engineLabel} · ${rs ? (rs === "captured" ? "captured" : rs === "failed" ? "capture failed" : "waiting")
          : d.severity === "error" ? `${d.errors} error${d.errors === 1 ? "" : "s"}` : d.severity === "warning" ? `${d.warnings} warning${d.warnings === 1 ? "" : "s"}`
          : d.severity === "inconclusive" ? "not captured" : "clean"}`,
        tone: rs ? RUN_CELL[rs] : CELL[d.severity],
      };
    }),
  }));

  const runLine = running || progress.phase === "failed" ? (
    <div className="flex basis-full flex-col gap-1.5" role="status" aria-live="polite">
      <p className={cn("text-[12.5px]", progress.phase === "failed" ? "text-error" : "text-text-secondary")}>{note}</p>
      {running && (
        <div className="h-1.5 w-full max-w-md overflow-hidden rounded-full bg-border-soft">
          <div className="h-full rounded-full bg-[linear-gradient(90deg,var(--color-brand-purple),var(--color-accent))] motion-safe:transition-[width] motion-safe:duration-500"
               style={{ width: `${Math.max(4, progressPct(progress))}%` }} />
        </div>
      )}
    </div>
  ) : null;

  const picker = views.length ? (
    <>
      <div className="flex w-full items-center gap-2.5 @3xl:w-auto">
        <BarLabel>Device</BarLabel>
        <Listbox label="Device" options={options} value={current?.profileId ?? null} onChange={pick} className="min-w-0 flex-1 @3xl:w-72 @3xl:flex-none" />
      </div>
      <Glance rows={glanceRows} selected={current?.profileId ?? null} onPick={pick} label="All devices at a glance" />
      {runLine}
    </>
  ) : (
    <p className="text-[13px] text-text-muted">
      {running ? "The first run has no devices to list yet." : "Run the check to see it here."}
    </p>
  );

  // ── Stage ──────────────────────────────────────────────────────────────────
  const mode = !current ? "none" : showStream ? "stream" : showCompare ? "compare" : "single";
  const swap = {
    initial: reduce ? false as const : { opacity: 0, scale: 0.985 },
    animate: { opacity: 1, scale: 1 },
    exit: reduce ? { opacity: 0 } : { opacity: 0, scale: 0.985 },
    transition: reduce ? { duration: 0 } : { duration: 0.22, ease: [0.22, 1, 0.36, 1] as const },
  };

  const frame = current ? (
    <AnimatePresence mode="wait" initial={false}>
      {mode === "stream" ? (
        <motion.div key="stream" {...swap} className="flex w-full flex-col items-center gap-3">
          <div className="w-full max-w-[420px]">
            <LiveSession
              url={url}
              profileId={current.profileId}
              viewport={current.viewport}
              hasTouch={current.shape !== "desktop"}
              onExit={() => setStreaming(false)}
            />
          </div>
          <StageCaption title={current.label}>{" · "}{current.engineLabel}{" · "}{current.viewportLabel}{" · "}live</StageCaption>
        </motion.div>
      ) : mode === "compare" ? (
        <motion.div key="compare" {...swap} className="flex w-full flex-col items-center gap-3">
          <div className="grid w-full gap-3 md:grid-cols-3">
            {columns.map((c) => {
              const s = srcFor(c.profileId);
              const hl = selectedColItem && selectedCol === c.engine ? selectedColItem.box : null;
              return (
                <div key={c.profileId} className="flex min-w-0 flex-col items-center gap-2">
                  <DeviceFrame
                    shape="desktop"
                    viewport={current.viewport}
                    src={s.live ?? s.fold}
                    fallbackSrc={s.fold}
                    alt={`${viewportName} at ${current.viewportLabel}, rendered by ${c.engineLabel}`}
                    title={url.replace(/^https?:\/\//, "")}
                    maxHeight={420}
                    highlight={hl}
                    onImageMeta={(m) => setColMeta((prev) => ({ ...prev, [c.engine]: m?.cssHeight ?? null }))}
                    frameClassName={ON_STAGE}
                  />
                  <StageCaption title={c.engineLabel}>
                    {" · "}{c.status !== "ok" ? c.status : `${c.errors} error${c.errors === 1 ? "" : "s"} · ${c.warnings} warning${c.warnings === 1 ? "" : "s"}`}
                  </StageCaption>
                </div>
              );
            })}
          </div>
        </motion.div>
      ) : (
        <motion.div key={`single-${current.profileId}`} {...swap} className="flex w-full flex-col items-center gap-3">
          <DeviceFrame
            shape={current.shape}
            viewport={current.viewport}
            src={src.live ?? src.fold}
            fallbackSrc={src.fold}
            liveSrc={showLive ? qaUrl(url) : null}
            alt={showLive ? `${current.label}, the live page` : `${current.label}, rendered page`}
            title={url.replace(/^https?:\/\//, "")}
            maxHeight={640}
            highlight={selectedItem?.box ?? null}
            onImageMeta={setImageMeta}
            frameClassName={ON_STAGE}
          />
          <StageCaption title={current.label}>
            {" · "}{showLive ? current.viewportLabel : `${current.engineLabel} · ${current.viewportLabel}`}
            {showLive && <span className="mt-0.5 block text-[11.5px]">{LIVE_CAVEAT}</span>}
          </StageCaption>
        </motion.div>
      )}
    </AnimatePresence>
  ) : null;

  // The bar under the device. "Open in a window" is your browser, not the
  // device's: the tooltip says so.
  const bar = current ? (
    <StageBar note={embed?.reason}>
      {canCompare && (
        <StageButton
          on={showCompare}
          onClick={() => { setCompare((c) => !c); setFinding(null); }}
          title="The three engines side by side at this width."
        >
          <Columns3 className="size-4" aria-hidden /> Compare engines
        </StageButton>
      )}
      {!showCompare && (
        <StageButton
          on={showLive || showStream}
          onClick={goLive}
          disabled={Boolean(embed?.checking)}
          title={showLive || showStream ? "Back to the captured screenshot, where findings can be drawn."
                 : canStream ? "Runs a real browser on this device profile — taps arrive as touch events."
                 : "Loads the real page inside the frame at this viewport."}
        >
          {embed?.checking ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Globe className="size-4" aria-hidden />}
          {embed?.checking ? "Checking…"
            : showStream || showLive ? "Show the capture"
            : canStream ? "Use it live" : "Open live here"}
        </StageButton>
      )}
      <StageButton
        onClick={() => window.open(url, "_blank", `width=${current.viewport.width},height=${current.viewport.height}`)}
        title="Opens the live page in your own browser at this size — your browser, not the device's."
      >
        <ExternalLink className="size-4" aria-hidden /> Open in a window
      </StageButton>
    </StageBar>
  ) : null;

  // ── Rail ───────────────────────────────────────────────────────────────────
  const rail = current && showCompare ? (
    <div className="grid gap-5 @3xl:grid-cols-3">
      {columns.map((c) => (
        <FindingsRail
          key={c.profileId}
          deviceLabel={c.engineLabel}
          heading={
            <p className="mb-2 flex items-baseline gap-2 border-b border-border-soft pb-2 text-[11.5px] font-semibold uppercase tracking-[0.08em] text-text-muted">
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
          onSelect={(id) => { if (id !== finding) revealStage(); setFinding((cur) => (cur === id ? null : id)); }}
          expanded={expanded}
          onToggle={() => setExpanded((e) => !e)}
          drawableHeight={colMeta[c.engine] ?? null}
          columns={false}
        />
      ))}
    </div>
  ) : current ? (
    current.status !== "ok" ? (
      <div className="flex flex-col">
        <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border-soft pb-3">
          <p className="text-[11.5px] font-semibold uppercase tracking-[0.08em] text-text-muted">Findings</p>
          <p className="truncate text-[12.5px] font-medium text-text-secondary">{current.label}</p>
        </div>
        <div className="flex max-w-xl items-start gap-3 rounded-xl bg-card-soft p-4 ring-1 ring-border-soft">
          <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-text-muted/25 text-text-primary">
            <ShieldAlert className="size-5" aria-hidden />
          </span>
          <p className="text-[13px] leading-snug text-text-secondary">
            {current.status === "blocked" ? "Blocked by bot protection — nothing on this device was audited." : `Capture failed${current.error ? `: ${current.error}` : "."}`}
          </p>
        </div>
      </div>
    ) : (
      <FindingsRail
        deviceLabel={current.label}
        items={items}
        selectedId={finding}
        onSelect={(id) => {
          // A box is drawn on the capture, so choosing a finding comes back
          // from the live page rather than selecting into nothing — and
          // brings the stage back if the list has scrolled it away.
          setLive(false);
          setStreaming(false);
          if (id !== finding) revealStage();
          setFinding((cur) => (cur === id ? null : id));
        }}
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
      action={bar}
      rail={rail}
      railLabel={current ? (showCompare ? `Findings by engine at ${current.viewportLabel}` : `Findings on ${current.label}`) : "Findings"}
    />
  );
}
