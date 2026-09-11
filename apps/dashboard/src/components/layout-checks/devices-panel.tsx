"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { readDeviceView, syncQuery } from "@/lib/layout-checks/deep-link";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Columns3, ExternalLink, Globe, Loader2, Maximize2, ShieldAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { CheckShell, ON_STAGE, revealStage, SectionHeading, StageBar, StageButton, StageCaption } from "@/components/layout-checks/check-shell";
import { DeviceFrame, type PinMarker } from "@/components/layout-checks/device-frame";
import { FindingsRail } from "@/components/layout-checks/findings-rail";
import { HealthMatrix } from "@/components/layout-checks/health-matrix";
import { coverage } from "@/lib/layout-checks/matrix";
import type { TrendPoint } from "@/lib/layout-checks/sparkline";
import { RAIL_CAP, railItems } from "@/lib/layout-checks/findings-view";
import { pinsFor } from "@/lib/layout-checks/pins";
import { auditedCount, devicesWith, reachKey, reachMap, type Reach } from "@/lib/layout-checks/reach";
import { LIVE_CAVEAT, qaUrl } from "@/lib/layout-checks/embed";
import { ms } from "@/lib/layout-checks/motion";
import { LiveSession } from "@/components/layout-checks/live-session";
import { comparableEngines, engineColumns } from "@/lib/layout-checks/engines-view";
import { DevicePreviewRunner } from "@/components/layout-checks/device-preview-runner";
import {
  IDLE_PROGRESS, isBusy, progressNote, progressPct, type DeviceRunState, type RunProgress,
} from "@/lib/layout-checks/run-progress";
import type { TabVerdict } from "@/lib/layout-checks/verdict";
import {
  defaultSelection, toView,
  type DeviceInput, type DeviceView,
} from "@/lib/layout-checks/devices-view";

// The Devices tab: pick one device, see that device. The picker is a dropdown
// grouped Apple / Android / Tablet / Desktop, worst first inside each group,
// with the worst one selected on load — and beside it a glance strip, one
// coloured cell per device, so all fourteen are read at once and any one is
// a click away. The device sits large on the dark stage; the bar under it
// holds compare, live and open; the findings run under the stage.


export function DevicesPanel({
  verdict,
  runId,
  devices,
  storedFolds,
  liveAvailable,
  headerAction,
  run,
  url,
  trend,
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
  /** Errors per run, newest first, for the trend beside the verdict. */
  trend?: TrendPoint[];
}) {
  const reduce = useReducedMotion();
  // A run in flight, drawn over the glance strip: every device grey, each one
  // turning to what the service actually reported for it. The severities
  // belong to the last saved run, so they step aside until this one is saved.
  const [progress, setProgress] = useState<RunProgress>(IDLE_PROGRESS);
  const running = isBusy(progress);
  const note = progressNote(progress);

  const views = useMemo(() => devices.map(toView), [devices]);
  // A link can name the device and the finding; the run decides whether they
  // exist. Otherwise the worst device opens, as before.
  const params = useSearchParams();
  const asked = readDeviceView(params, views.map((v) => v.profileId));
  const [selected, setSelected] = useState<string | null>(() => asked.device ?? defaultSelection(views));
  const current: DeviceView | undefined = views.find((v) => v.profileId === selected) ?? views[0];
  const stored = new Set(storedFolds);

  // Rail state is per device: a new device means no selected finding, the
  // list folded back to five, and no assumptions about the image until it loads.
  const [finding, setFinding] = useState<string | null>(asked.finding);
  // …and once chosen, the view goes back into the address bar, so any row on
  // this page is a link that opens to exactly this.
  useEffect(() => { syncQuery({ device: selected, finding }); }, [selected, finding]);
  const [expanded, setExpanded] = useState(false);
  const [imageMeta, setImageMeta] = useState<{ cssHeight: number } | null>(null);
  // What the frame is showing right now, for the rail's element crops.
  const [shownSrc, setShownSrc] = useState<string | null>(null);
  const pick = (profileId: string) => {
    setSelected(profileId); setFinding(null); setImageMeta(null); setColMeta({});
    setStreaming(false);            // the session is pinned to one profile
    setZoom("fit");                 // a new device is a new frame, fitted
  };
  const currentRaw = devices.find((d) => d.profile_id === current?.profileId);
  const items = useMemo(() => railItems(currentRaw?.findings ?? []), [currentRaw]);
  const selectedItem = items.find((i) => i.id === finding) ?? null;

  // The same numbering the list shows, so a pin and its row cannot disagree.
  const pins: PinMarker[] = useMemo(
    () => pinsFor(items, imageMeta?.cssHeight ?? null)
      .map((pin) => ({ ...pin, label: items.find((i) => i.id === pin.id)?.label ?? "" })),
    [items, imageMeta],
  );
  const selectFinding = (id: string) => {
    // A box is drawn on the capture, so choosing a finding comes back from
    // the live page rather than selecting into nothing.
    setLive(false);
    setStreaming(false);
    setFinding((cur) => (cur === id ? null : id));
  };
  // From a pin: select, never toggle off, and bring its row into view — the
  // list is under the stage, and the row may be a screen away.
  // A pin or a map dot can name a finding the rail has folded away below its
  // cap, so the rail is opened first; the existing scroll then has a row to go to.
  const selectFromPin = (id: string) => {
    setLive(false); setStreaming(false); setFinding(id);
    // After the row has finished opening, not before. It grows as it opens,
    // and a page scrolled to its old end cannot centre a row that is about to
    // get taller — scroll once the document is its final height.
    window.setTimeout(() => {
      document.getElementById(`finding-${id}`)?.scrollIntoView({
        block: "center", behavior: ms(300) === 0 ? "auto" : "smooth",
      });
    }, ms(220));
    if (items.findIndex((i) => i.id === id) >= RAIL_CAP) setExpanded(true);
  };

  // How widely each finding reaches across the matrix: one device's quirk, or
  // the whole site. Computed from every audited device in this run.
  const reach = useMemo(() => reachMap(devices), [devices]);
  const audited = useMemo(() => auditedCount(devices), [devices]);
  const reachOf = (it: { rule: string; selector: string | null; pageLevel: boolean }): Reach | null => {
    const n = reach.get(reachKey(it.rule, it.selector, it.pageLevel ? "page" : undefined));
    return n ? { devices: n, audited } : null;
  };
  // The other devices carrying the same finding, by name, for the open row.
  const alsoOn = (it: { rule: string; selector: string | null; pageLevel: boolean }): string[] =>
    devicesWith(devices, reachKey(it.rule, it.selector, it.pageLevel ? "page" : undefined)).filter((l) => l !== current?.label);

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
  // Fit is the frame the stage can hold; 1:1 is the page's own pixels, the
  // only honest way to judge "11px text" or a 24px tap target by eye.
  const [zoom, setZoom] = useState<"fit" | "actual">("fit");

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
  // The fold is ours and fast; the full page is the service's and slow. Ask
  // for the fold, and let the frame upgrade to the full page behind it.
  const srcFor = (profileId: string) => ({
    live: runId && liveAvailable ? `/api/devicepreview/live?runId=${runId}&profile=${encodeURIComponent(profileId)}&kind=full` : null,
    fold: runId && stored.has(profileId) ? `/api/devicepreview/shot?runId=${runId}&profile=${encodeURIComponent(profileId)}` : null,
  });
  const src = current ? srcFor(current.profileId) : { live: null, fold: null };

  // ── Picker: the dropdown, the glance strip, and the run line while a run is on ──
  const runState = (d: DeviceView): DeviceRunState | null => running ? progress.devices[d.label] ?? "waiting" : null;

  const runLine = running || progress.phase === "failed" ? (
    <div className="flex basis-full flex-col gap-2" role="status" aria-live="polite">
      <p className={cn("text-[12px]", progress.phase === "failed" ? "text-error-strong" : "text-text-secondary")}>{note}</p>
      {running && (
        <div className="h-1 w-full max-w-md overflow-hidden rounded-full bg-border-soft">
          <div className="h-full rounded-full bg-text-primary/70 motion-safe:transition-[width] motion-safe:duration-500"
               style={{ width: `${Math.max(4, progressPct(progress))}%` }} />
        </div>
      )}
    </div>
  ) : null;

  // The matrix is the picker. What is left of the old picker row is the run
  // line, which only exists while a run is on.
  const picker = views.length ? runLine : (
    <p className="text-[13px] text-text-secondary">
      {running ? "The first run has no devices to list yet." : "Run the check to see it here."}
    </p>
  );
  const cov = coverage(views);
  const chip = "inline-flex h-6 items-center rounded-full px-2.5 text-[11px] font-semibold";
  const chips = views.length ? (
    <>
      {cov.failing > 0 && <span className={cn(chip, "bg-error/12 text-error-strong")}>{cov.failing} failing</span>}
      {cov.warnings > 0 && <span className={cn(chip, "bg-warning/15 text-warning-strong")}>{cov.warnings} with warnings</span>}
      {cov.clean > 0 && <span className={cn(chip, "bg-success/12 text-success-strong")}>{cov.clean} clean</span>}
      {cov.inconclusive > 0 && <span className={cn(chip, "bg-card-soft text-text-secondary")}>{cov.inconclusive} not captured</span>}
    </>
  ) : null;
  const matrix = views.length ? (
    <HealthMatrix
      views={views}
      findingsOf={(id) => devices.find((d) => d.profile_id === id)?.findings ?? []}
      statusOf={(id) => devices.find((d) => d.profile_id === id)?.status ?? "ok"}
      selected={current?.profileId ?? null}
      onPick={pick}
      runState={running ? runState : undefined}
    />
  ) : null;

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
                    deviceId={c.profileId}
                    viewport={current.viewport}
                    src={s.fold ?? s.live}
                    fallbackSrc={s.fold ? s.live : null}
                    upgradeSrc={s.fold ? s.live : null}
                    alt={`${viewportName} at ${current.viewportLabel}, rendered by ${c.engineLabel}`}
                    title={url.replace(/^https?:\/\//, "")}
                    maxHeight={320}
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
            deviceId={current.profileId}
            viewport={current.viewport}
            src={src.fold ?? src.live}
            fallbackSrc={src.fold ? src.live : null}
            upgradeSrc={src.fold ? src.live : null}
            liveSrc={showLive ? qaUrl(url) : null}
            alt={showLive ? `${current.label}, the live page` : `${current.label}, rendered page`}
            title={url.replace(/^https?:\/\//, "")}
            maxHeight="fill"
            highlight={selectedItem?.box ?? null}
            onImageMeta={setImageMeta}
            frameClassName={ON_STAGE}
            zoom={showLive ? "fit" : zoom}
            pins={showLive ? [] : pins}
            selectedPin={finding}
            onPinSelect={selectFromPin}
            onShown={setShownSrc}
            minimap
          />
          <StageCaption title={current.label}>
            {" · "}{showLive ? current.viewportLabel : `${current.engineLabel} · ${current.viewportLabel}`}
            {showLive && <span className="mt-1 block text-[11px]">{LIVE_CAVEAT}</span>}
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
      {!showCompare && !showStream && !showLive && (
        <StageButton
          on={zoom === "actual"}
          onClick={() => setZoom((z) => (z === "actual" ? "fit" : "actual"))}
          title={zoom === "actual" ? "Back to a frame that fits the stage." : "Show the capture at the page's own pixel size — how big the text and buttons really are."}
        >
          <Maximize2 className="size-4" aria-hidden /> {zoom === "actual" ? "Fit" : "Actual size"}
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
    <div className="flex flex-col gap-5">
      {columns.map((c) => (
        <FindingsRail
          key={c.profileId}
          deviceLabel={c.engineLabel}
          heading={
            <SectionHeading label={c.engineLabel} subject={
              c.errors + c.warnings > 0
                ? `${c.errors + c.warnings} finding${c.errors + c.warnings === 1 ? "" : "s"}`
                : c.items.length > 0 ? `${c.items.length} note${c.items.length === 1 ? "" : "s"}` : "clean"
            } />
          }
          items={c.items.map((it) => ({ ...it, id: compareId(c.engine, it.id), tag: it.onlyHere ? `only in ${c.engineLabel}` : undefined }))}
          selectedId={finding}
          onSelect={(id) => { if (id !== finding) revealStage(); setFinding((cur) => (cur === id ? null : id)); }}
          expanded={expanded}
          onToggle={() => setExpanded((e) => !e)}
          drawableHeight={colMeta[c.engine] ?? null}
          showPins={false}
          where={`${viewportName} · ${c.engineLabel} · ${current.viewportLabel}`}
          url={url}
        />
      ))}
    </div>
  ) : current ? (
    current.status !== "ok" ? (
      <div className="flex flex-col">
        <SectionHeading label="Findings" subject={current.label} />
        {/* Also one sentence, also no box. */}
        <p className="flex items-start gap-2 text-[13px] leading-snug text-text-secondary">
          <ShieldAlert className="mt-px size-5 shrink-0 text-text-secondary" aria-hidden />
          {current.status === "blocked" ? "Blocked by bot protection — nothing on this device was audited." : `Capture failed${current.error ? `: ${current.error}` : "."}`}
        </p>
      </div>
    ) : (
      <FindingsRail
        deviceLabel={current.label}
        items={items}
        selectedId={finding}
        onSelect={(id) => { if (id !== finding) revealStage(); selectFinding(id); }}
        expanded={expanded}
        onToggle={() => setExpanded((e) => !e)}
        drawableHeight={imageMeta?.cssHeight ?? null}
        where={`${current.label} · ${current.engineLabel} · ${current.viewportLabel}`}
        url={url}
        reachOf={reachOf}
        alsoOn={alsoOn}
        thumbs={showLive ? null : { src: shownSrc, pageWidth: current.viewport.width, pageHeight: imageMeta?.cssHeight ?? null }}
      />
    )
  ) : (
    <p className="text-[13px] text-text-secondary">No run yet.</p>
  );

  return (
    <CheckShell
      verdict={verdict}
      chips={chips}
      trend={trend}
      matrix={matrix}
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
