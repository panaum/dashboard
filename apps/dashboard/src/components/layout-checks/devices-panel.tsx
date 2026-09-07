"use client";

import { useMemo, useState, type ReactNode } from "react";
import { ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { CheckShell } from "@/components/layout-checks/check-shell";
import { DeviceFrame } from "@/components/layout-checks/device-frame";
import { FindingsRail } from "@/components/layout-checks/findings-rail";
import { railItems } from "@/lib/layout-checks/findings-view";
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
  url,
}: {
  verdict: TabVerdict;
  runId: string | null;
  devices: DeviceInput[];
  storedFolds: string[];
  /** The preview service is configured, so full-page images may still be served live. */
  liveAvailable: boolean;
  /** The run control; sits beside the verdict, not under the frame. */
  headerAction?: ReactNode;
  url: string;
}) {
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
  const pick = (profileId: string) => { setSelected(profileId); setFinding(null); setImageMeta(null); };
  const currentRaw = devices.find((d) => d.profile_id === current?.profileId);
  const items = useMemo(() => railItems(currentRaw?.findings ?? []), [currentRaw]);
  const selectedItem = items.find((i) => i.id === finding) ?? null;

  // Try the live full page only where it can exist; a request the page knows
  // will fail is a blank frame for as long as it takes to fail.
  const live = current && runId && liveAvailable ? `/api/devicepreview/live?runId=${runId}&profile=${encodeURIComponent(current.profileId)}&kind=full` : null;
  const fold = current && runId && stored.has(current.profileId) ? `/api/devicepreview/shot?runId=${runId}&profile=${encodeURIComponent(current.profileId)}` : null;

  const picker = views.length ? (
    <div className="flex flex-wrap gap-x-7 gap-y-3" role="group" aria-label="Devices">
      {groups.map(({ group, devices: ds }) => (
        <div key={group} className="flex flex-col gap-1.5">
          <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-text-muted">{group}</span>
          <div className="flex flex-wrap gap-1.5">
            {ds.map((d) => {
              const on = d.profileId === current?.profileId;
              return (
                <button
                  key={d.profileId}
                  type="button"
                  aria-pressed={on}
                  onClick={() => pick(d.profileId)}
                  title={`${d.label} · ${d.engineLabel} · ${d.viewportLabel}`}
                  className={cn(
                    "group flex flex-col items-start rounded-lg px-2.5 py-1.5 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent",
                    on ? "bg-accent text-text-on-dark" : "border border-border-soft bg-card text-text-primary hover:border-accent/50",
                  )}
                >
                  <span className="flex items-center gap-1.5 text-[13px] font-medium leading-tight">
                    {d.severity !== "clean" && (
                      <span aria-hidden className={cn("inline-block size-2 shrink-0 rounded-full", DOT[d.severity])} />
                    )}
                    <span className="sr-only">
                      {d.severity === "error" ? "has errors: " : d.severity === "warning" ? "has warnings: " : d.severity === "inconclusive" ? "not captured: " : ""}
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
    <p className="text-[13px] text-text-muted">Run the check to see it here.</p>
  );

  const frame = current ? (
    <div className="flex w-full flex-col items-center gap-2.5">
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
    </div>
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

  const rail = current ? (
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
      headerAction={headerAction}
      picker={picker}
      frame={frame}
      action={openAtSize}
      rail={rail}
      railLabel={current ? `Findings on ${current.label}` : "Findings"}
    />
  );
}
