"use client";

import { CheckCircle2 } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { explain } from "@/lib/layout-checks/explain";
import { ms } from "@/lib/layout-checks/motion";
import { RAIL_CAP, railSlice, type RailFinding } from "@/lib/layout-checks/findings-view";

export type RailItem = RailFinding & {
  tag?: string;
  /** Shown under the row while it is selected. The width findings carry a
      sentence worth reading; the device findings do not have one. */
  detail?: string;
};

// The findings for ONE screenshot, never all of them. Severity is a colour
// on the whole row, not a dot: a red-edged row is an error before it is read.
// Capped at five with a quiet expander; a mint tile when there is nothing to
// say. Clicking a row selects it, draws its box in the frame if it has one,
// and opens what the finding means beneath it.

const ROW: Record<RailFinding["severity"], { bar: string; on: string; chip: string; word: string }> = {
  error: { bar: "bg-error", on: "bg-error/[0.07] ring-error/25", chip: "bg-error/12 text-error", word: "Error" },
  warn:  { bar: "bg-warning", on: "bg-warning/[0.09] ring-warning/30", chip: "bg-warning/15 text-warning", word: "Warning" },
  info:  { bar: "bg-text-muted/40", on: "bg-card-soft ring-border-soft", chip: "bg-card-soft text-text-secondary", word: "Note" },
};

function Summary({ items }: { items: RailItem[] }) {
  const n = (s: RailFinding["severity"]) => items.filter((i) => i.severity === s).length;
  const parts: { k: RailFinding["severity"]; n: number; label: string }[] = [
    { k: "error" as const, n: n("error"), label: "error" },
    { k: "warn" as const, n: n("warn"), label: "warning" },
    { k: "info" as const, n: n("info"), label: "note" },
  ].filter((p) => p.n > 0);
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      {parts.map((p) => (
        <span key={p.k} className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums", ROW[p.k].chip)}>
          {p.n} {p.label}{p.n === 1 ? "" : "s"}
        </span>
      ))}
    </span>
  );
}

export function FindingsRail({
  deviceLabel,
  items,
  heading,
  kind = "device",
  selectedId,
  onSelect,
  expanded,
  onToggle,
  drawableHeight,
}: {
  deviceLabel: string;
  items: RailItem[];
  /** Which vocabulary the rule names belong to, for the explanation. */
  kind?: "device" | "viewport";
  /** A custom header, used in engine comparison; the default names the device and counts. */
  heading?: ReactNode;
  selectedId: string | null;
  onSelect: (id: string) => void;
  expanded: boolean;
  onToggle: () => void;
  /** Height of the loaded screenshot in CSS px; a box below it cannot be drawn. */
  drawableHeight: number | null;
}) {
  const head = heading ?? (
    <div className="mb-3 flex flex-col gap-2 border-b border-border-soft pb-3">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-[11.5px] font-semibold uppercase tracking-[0.08em] text-text-muted">Findings</p>
        <p className="truncate text-[12px] text-text-secondary">{deviceLabel}</p>
      </div>
      {items.length > 0 && <Summary items={items} />}
    </div>
  );

  if (!items.length) {
    return (
      <div className="flex flex-col">
        {head}
        <div className="flex items-center gap-3 rounded-xl bg-[linear-gradient(135deg,rgba(76,175,125,0.14),rgba(76,175,125,0.04))] p-4 ring-1 ring-success/20">
          <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-success text-white shadow-sm">
            <CheckCircle2 className="size-5" strokeWidth={2.25} aria-hidden />
          </span>
          <p className="text-[13.5px] font-medium leading-snug text-text-primary">Nothing to fix on {deviceLabel}</p>
        </div>
      </div>
    );
  }

  const { shown, hidden } = railSlice(items, expanded);
  return (
    <div className="flex flex-col">
      {head}
      <ul className="flex flex-col gap-1" aria-label={`Findings on ${deviceLabel}`}>
        {shown.map((it) => {
          const on = it.id === selectedId;
          const s = ROW[it.severity];
          // The finding has a measured place on the page; what is missing is
          // the image to draw it on. Say that, and do not offer a click that
          // would draw nothing.
          const notStored = it.box !== null && drawableHeight !== null && it.box.y >= drawableHeight;
          if (notStored) {
            return (
              <li key={it.id} className="relative flex flex-col items-start gap-0.5 rounded-lg py-2 pl-4 pr-2.5 opacity-80">
                <span aria-hidden className={cn("absolute inset-y-2 left-0 w-[3px] rounded-full", s.bar)} />
                <span className="text-[13px] font-medium leading-snug text-text-secondary">{it.label}</span>
                <span className="font-mono text-[11px] leading-snug text-text-muted">{it.selector ?? "—"}</span>
                <span className="text-[10.5px] text-text-muted/80">full page not stored for this run</span>
              </li>
            );
          }
          const help = on ? explain(kind, it.rule) : null;
          return (
            <li key={it.id} className={cn("rounded-lg transition-[background-color,box-shadow] duration-200", on && cn("ring-1 ring-inset", s.on))}>
              <button
                type="button"
                aria-pressed={on}
                onClick={() => onSelect(it.id)}
                className={cn(
                  "relative flex w-full flex-col items-start gap-0.5 rounded-lg py-2 pl-4 pr-2.5 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent",
                  !on && "hover:bg-card-soft",
                )}
              >
                <span aria-hidden className={cn("absolute inset-y-2 left-0 w-[3px] rounded-full", s.bar)} />
                <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] font-medium leading-snug text-text-primary">
                  <span className="sr-only">{s.word}: </span>
                  {it.label}
                  {it.tag && (
                    <span className="whitespace-nowrap rounded bg-accent/10 px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide text-accent">{it.tag}</span>
                  )}
                </span>
                <span className="font-mono text-[11px] leading-snug text-text-muted">
                  {it.pageLevel ? "whole page" : (it.selector ?? "—")}
                </span>
              </button>

              {/* What it means, once you have chosen it. The measurement above
                  is the evidence; this is whether to care and what to do. */}
              <div
                inert={!on}
                style={{ display: "grid", gridTemplateRows: on ? "1fr" : "0fr",
                         transition: `grid-template-rows ${ms(180)}ms ease` }}
              >
                <div className="overflow-hidden">
                  <div className="mx-4 mb-3 mt-0.5 flex flex-col gap-1.5 text-[11.5px] leading-relaxed">
                    {(it.detail || it.message) && (
                      <p className="text-text-primary">{it.detail || it.message}</p>
                    )}
                    {help && <p className="text-text-secondary">{help.why}</p>}
                    {help?.fix && <p className="text-text-muted">{help.fix}</p>}
                    {!help && !it.detail && !it.message && (
                      <p className="text-text-muted">No further detail was recorded for this finding.</p>
                    )}
                  </div>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
      {(hidden > 0 || (expanded && items.length > RAIL_CAP)) && (
        <button
          type="button"
          onClick={onToggle}
          className="mt-2 self-start rounded-full border border-border-soft px-3 py-1 text-[12px] font-medium text-text-secondary transition-colors hover:border-accent/40 hover:text-text-primary focus-visible:outline-2 focus-visible:outline-accent"
        >
          {hidden > 0 ? `Show ${hidden} more` : "Show fewer"}
        </button>
      )}
    </div>
  );
}
