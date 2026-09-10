"use client";

import { useMemo, useState, type ReactNode } from "react";
import { ExternalLink } from "lucide-react";
import { Listbox, type ListOption, type ListTone } from "@/components/ui/listbox";
import { CheckShell, ON_STAGE, StageBar, StageButton, StageCaption } from "@/components/layout-checks/check-shell";
import { DeviceFrame } from "@/components/layout-checks/device-frame";
import { FindingsRail } from "@/components/layout-checks/findings-rail";
import { Glance, type GlanceTone } from "@/components/layout-checks/glance";
import type { TabVerdict } from "@/lib/layout-checks/verdict";
import { widthLabel } from "@/lib/linkspy/responsive-view";
import {
  defaultWidth, firstWidthOf, hasPerWidth, severityAt, viewportRail, widthShape,
  widthViewport, type ViewportFinding, type WidthSeverity,
} from "@/lib/layout-checks/viewports-view";

// The Viewports tab: pick one width, see the page at that width, read the
// findings for that width. The same shell, dropdown, glance strip and rail
// as the Devices tab, so the interaction is learned once.

const TONE: Record<WidthSeverity, ListTone | undefined> = { error: "error", warning: "warning", clean: "success", unknown: undefined };
const CELL: Record<WidthSeverity, GlanceTone> = { error: "error", warning: "warning", clean: "success", unknown: "neutral" };
const SHAPE_WORD = { phone: "Phone", tablet: "Tablet", desktop: "Desktop" } as const;

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
  const key = (w: number) => `w${w}`;
  const fromKey = (id: string) => Number(id.slice(1));

  const options: ListOption[] = asc.map((w) => {
    const sev = severityAt(findings, w);
    const shape = widthShape(w);
    return {
      id: key(w),
      label: `${w}px`,
      sub: `${SHAPE_WORD[shape]}${sev === "error" ? " · breaks here" : sev === "warning" ? " · worth a look" : ""}`,
      tone: TONE[sev],
      group: `${SHAPE_WORD[shape]}s`,
    };
  });
  const glance = [{
    name: "Widths",
    cells: asc.map((w) => {
      const sev = severityAt(findings, w);
      return { id: key(w), label: `${widthLabel(w)} · ${sev === "error" ? "breaks here" : sev === "warning" ? "worth a look" : sev === "clean" ? "clean" : "not captured"}`, tone: CELL[sev] };
    }),
  }];

  const picker = asc.length ? (
    <div className="flex flex-col gap-3">
      {!perWidth && (
        <p className="rounded-xl bg-card-soft px-3.5 py-3 text-[12.5px] leading-snug text-text-secondary">
          This run predates per-width findings, so the list on the right is everything found
          across all {asc.length} widths, not just this one. The next run will split them.
        </p>
      )}
      <div className="flex flex-col gap-1.5">
        <span className="px-1 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-text-muted">Width</span>
        <Listbox label="Width" options={options} value={current === null ? null : key(current)} onChange={(id) => pick(fromKey(id))} />
      </div>
      <Glance rows={glance} selected={current === null ? null : key(current)} onPick={(id) => pick(fromKey(id))} label="All widths at a glance" />
    </div>
  ) : (
    <p className="px-1 text-[13px] text-text-muted">Run the check to see it here.</p>
  );

  const frame = current !== null && runId ? (
    <div className="flex w-full flex-col items-center gap-3">
      <DeviceFrame
        shape={widthShape(current)}
        viewport={widthViewport(current)}
        src={`/api/layout-shot?runId=${runId}&width=${current}`}
        fallbackSrc={null}
        alt={`The page rendered ${current} pixels wide`}
        title={url.replace(/^https?:\/\//, "")}
        highlight={null}
        frameClassName={ON_STAGE}
      />
      <StageCaption title={`${current}px`}>{" · "}{SHAPE_WORD[widthShape(current)]}{" · "}{widthViewport(current).width} × {widthViewport(current).height}</StageCaption>
    </div>
  ) : null;

  // Your browser at that width, not a phone. The tooltip says so.
  const bar = current !== null ? (
    <StageBar>
      <StageButton
        onClick={() => window.open(url, "_blank", `width=${current},height=${widthViewport(current).height}`)}
        title="Opens the live page in your own browser at this width — your browser, not a device."
      >
        <ExternalLink className="size-4" aria-hidden /> Open at this size
      </StageButton>
    </StageBar>
  ) : null;

  const rail = current === null ? (
    <p className="text-[13px] text-text-muted">No run yet.</p>
  ) : (
    <FindingsRail
      deviceLabel={perWidth ? `${current}px` : "this run"}
      kind="viewport"
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
      action={bar}
      rail={rail}
      railLabel={current === null ? "Findings" : perWidth ? `Findings at ${current}px` : "Findings across all widths"}
    />
  );
}
