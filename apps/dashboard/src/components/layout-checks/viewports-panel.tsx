"use client";

import { useMemo, useState, type ReactNode } from "react";
import { ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { CheckShell } from "@/components/layout-checks/check-shell";
import { DeviceFrame } from "@/components/layout-checks/device-frame";
import { FindingsRail } from "@/components/layout-checks/findings-rail";
import type { TabVerdict } from "@/lib/layout-checks/verdict";
import { widthLabel } from "@/lib/linkspy/responsive-view";
import {
  defaultWidth, firstWidthOf, hasPerWidth, severityAt, viewportRail, widthShape,
  widthViewport, type ViewportFinding, type WidthSeverity,
} from "@/lib/layout-checks/viewports-view";

// The Viewports tab: pick one width, see the page at that width, read the
// findings for that width. The same shell, picker and rail as the Devices
// tab, so the interaction is learned once.

const DOT: Record<WidthSeverity, string> = {
  error: "bg-error", warning: "bg-warning", clean: "", unknown: "",
};

export function ViewportsPanel({
  verdict,
  runId,
  findings,
  widths,
  headerAction,
  url,
}: {
  verdict: TabVerdict;
  runId: string | null;
  findings: ViewportFinding[];
  /** Widths with a stored screenshot, ascending. */
  widths: number[];
  headerAction?: ReactNode;
  url: string;
}) {
  const asc = useMemo(() => [...widths].sort((a, b) => a - b), [widths]);
  const perWidth = hasPerWidth(findings);
  const [selected, setSelected] = useState<number | null>(() => defaultWidth(findings, asc));
  const current = asc.includes(selected ?? -1) ? (selected as number) : asc[0] ?? null;
  const [finding, setFinding] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  const items = useMemo(
    () => (current === null ? [] : viewportRail(findings, current, asc)),
    [findings, current, asc],
  );

  // Selecting a finding is the one gesture this tab has that the Devices tab
  // does not need: a width finding has no box to highlight, so the click
  // takes you to the first width it names instead of doing nothing.
  const select = (id: string) => {
    if (id === finding) { setFinding(null); return; }
    setFinding(id);
    const jump = firstWidthOf(findings.find((f) => f.id === id), current);
    if (jump !== null && jump !== current && asc.includes(jump)) setSelected(jump);
  };

  const pick = (w: number) => { setSelected(w); setFinding(null); };

  const picker = asc.length ? (
    <div className="flex flex-col gap-3">
      {!perWidth && (
        <p className="text-[12.5px] text-text-muted">
          This run predates per-width findings, so the list on the right is everything found
          across all {asc.length} widths, not just this one. The next run will split them.
        </p>
      )}
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Widths">
        {asc.map((w) => {
          const on = w === current;
          const sev = severityAt(findings, w);
          return (
            <button
              key={w}
              type="button"
              aria-pressed={on}
              onClick={() => pick(w)}
              title={widthLabel(w)}
              className={cn(
                "flex flex-col items-start rounded-lg px-2.5 py-1.5 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent",
                on ? "bg-accent text-text-on-dark" : "border border-border-soft bg-card text-text-primary hover:border-accent/50",
              )}
            >
              <span className="flex items-center gap-1.5 text-[13px] font-medium leading-tight tabular-nums">
                {DOT[sev] && <span aria-hidden className={cn("inline-block size-2 shrink-0 rounded-full", DOT[sev])} />}
                <span className="sr-only">{sev === "error" ? "breaks here: " : sev === "warning" ? "worth a look: " : ""}</span>
                {w}px
              </span>
              <span className={cn("text-[10.5px]", on ? "text-text-on-dark/75" : "text-text-muted")}>
                {widthShape(w)}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  ) : (
    <p className="text-[13px] text-text-muted">Run the check to see it here.</p>
  );

  const frame = current !== null && runId ? (
    <div className="flex w-full flex-col items-center gap-2.5">
      <DeviceFrame
        shape={widthShape(current)}
        viewport={widthViewport(current)}
        src={`/api/layout-shot?runId=${runId}&width=${current}`}
        fallbackSrc={null}
        alt={`The page rendered ${current} pixels wide`}
        title={url.replace(/^https?:\/\//, "")}
        highlight={null}
      />
      <p className="text-[12px] text-text-muted">{widthLabel(current)}</p>
    </div>
  ) : null;

  // Your browser at that width, not a phone. The tooltip says so.
  const openAtSize = current !== null ? (
    <Button
      type="button"
      variant="secondary"
      size="sm"
      onClick={() => window.open(url, "_blank", `width=${current},height=${widthViewport(current).height}`)}
      title="Opens the live page in your own browser at this width — your browser, not a device."
    >
      <ExternalLink className="size-4" /> Open at this size
    </Button>
  ) : null;

  const rail = current === null ? (
    <p className="text-[13px] text-text-muted">No run yet.</p>
  ) : (
    <FindingsRail
      deviceLabel={perWidth ? `${current}px` : "this run"}
      items={items}
      selectedId={finding}
      onSelect={select}
      expanded={expanded}
      onToggle={() => setExpanded((e) => !e)}
      drawableHeight={null}
    />
  );

  return (
    <CheckShell
      verdict={verdict}
      headerAction={headerAction}
      picker={picker}
      frame={frame}
      action={openAtSize}
      rail={rail}
      railLabel={current === null ? "Findings" : perWidth ? `Findings at ${current}px` : "Findings across all widths"}
    />
  );
}
