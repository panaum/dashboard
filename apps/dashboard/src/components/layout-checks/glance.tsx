"use client";

import { type KeyboardEvent } from "react";
import { cn } from "@/lib/utils";
import { rovingTarget } from "@/lib/layout-checks/roving";

// Every device or width at once. Severity is the colour; a hollow cell was
// never captured. One tab stop, arrows walk the cells, and it is a radio
// group because it picks exactly one thing.
//
// Two sizes. "dot" is an indicator strip beside the device dropdown, fourteen
// cells on one line. "tile" is the control itself — big enough to carry its
// own label, which is what lets the Viewports tab drop its dropdown entirely
// and show severity across all eight widths at once.

export type GlanceTone = "error" | "warning" | "success" | "neutral" | "waiting" | "captured";

export type GlanceCell = {
  id: string;
  label: string;
  tone: GlanceTone;
  /** Shown inside the cell in "tile" size. */
  text?: string;
};

export type GlanceRow = { name: string; cells: GlanceCell[] };

// A solid fill for the small cells. Each carries a hairline so its edge is
// visible against white — amber on white is 2:1 on its own, under the 3:1 a
// non-text indicator needs.
const DOT: Record<GlanceTone, string> = {
  error: "bg-error ring-1 ring-inset ring-black/15",
  warning: "bg-warning ring-1 ring-inset ring-black/15",
  success: "bg-success ring-1 ring-inset ring-black/15",
  neutral: "border border-dashed border-text-muted",
  waiting: "bg-border-soft ring-1 ring-inset ring-black/10",
  captured: "bg-accent/70 ring-1 ring-inset ring-black/10",
};

// A tile carries a number, so the fill is a tint and the number is near-black:
// the same hue, read at any size, with the severity bar keeping the punch.
const TILE: Record<GlanceTone, { face: string; bar: string }> = {
  error: { face: "border-error/40 bg-error/10 hover:bg-error/20", bar: "bg-error" },
  warning: { face: "border-warning/45 bg-warning/12 hover:bg-warning/25", bar: "bg-warning" },
  success: { face: "border-success/40 bg-success/10 hover:bg-success/20", bar: "bg-success" },
  neutral: { face: "border-dashed border-text-muted/60 bg-transparent hover:bg-card-soft", bar: "bg-transparent" },
  waiting: { face: "border-border-soft bg-card-soft", bar: "bg-border-soft" },
  captured: { face: "border-accent/40 bg-accent/10", bar: "bg-accent/70" },
};

export function Glance({
  rows,
  selected,
  onPick,
  label,
  legend = true,
  size = "dot",
}: {
  rows: GlanceRow[];
  selected: string | null;
  onPick: (id: string) => void;
  label: string;
  legend?: boolean;
  size?: "dot" | "tile";
}) {
  const all = rows.flatMap((r) => r.cells);
  const tabTarget = all.some((c) => c.id === selected) ? selected : all[0]?.id ?? null;
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const j = rovingTarget(e.key, all.findIndex((c) => c.id === selected), all.length);
    if (j === null) return;
    e.preventDefault();
    onPick(all[j].id);
    document.getElementById(`glance-${all[j].id}`)?.focus();
  };
  const tile = size === "tile";
  return (
    <div role="radiogroup" aria-label={label} onKeyDown={onKey}
         className={cn("flex flex-wrap items-center", tile ? "gap-x-4 gap-y-3" : "gap-x-4 gap-y-2")}>
      {rows.map((r) => (
        <div key={r.name} className="flex items-center gap-2">
          {r.name && <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-text-muted">{r.name}</span>}
          <div className={cn("flex", tile ? "flex-wrap gap-2" : "gap-1")}>
            {r.cells.map((c) => {
              const on = c.id === selected;
              const common = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";
              return tile ? (
                <button
                  key={c.id}
                  id={`glance-${c.id}`}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  aria-label={c.label}
                  tabIndex={c.id === tabTarget ? 0 : -1}
                  onClick={() => onPick(c.id)}
                  className={cn(
                    "relative flex h-12 w-16 flex-col items-center justify-center overflow-hidden rounded-lg border transition-colors",
                    common, TILE[c.tone].face,
                    on && "border-accent bg-accent/10 ring-2 ring-accent hover:bg-accent/10",
                  )}
                >
                  <span className={cn("text-[13px] font-semibold tabular-nums leading-none",
                                      on ? "text-accent" : "text-text-primary")}>
                    {c.text ?? ""}
                  </span>
                  <span aria-hidden className={cn("absolute inset-x-0 bottom-0 h-[3px]", on ? "bg-accent" : TILE[c.tone].bar)} />
                </button>
              ) : (
                <button
                  key={c.id}
                  id={`glance-${c.id}`}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  aria-label={c.label}
                  tabIndex={c.id === tabTarget ? 0 : -1}
                  title={c.label}
                  onClick={() => onPick(c.id)}
                  className={cn("size-5 rounded transition-transform duration-200 hover:scale-110", common, DOT[c.tone],
                                on && "scale-110 ring-2 ring-accent ring-offset-2 ring-offset-card")}
                />
              );
            })}
          </div>
        </div>
      ))}
      {legend && (
        <div className={cn("flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-text-secondary",
                           tile ? "" : "border-l border-border-soft pl-3")}>
          <span className="flex items-center gap-1.5"><i className={cn("inline-block size-2.5 rounded-[3px]", DOT.error)} />errors</span>
          <span className="flex items-center gap-1.5"><i className={cn("inline-block size-2.5 rounded-[3px]", DOT.warning)} />warnings</span>
          <span className="flex items-center gap-1.5"><i className={cn("inline-block size-2.5 rounded-[3px]", DOT.success)} />clean</span>
          <span className="flex items-center gap-1.5"><i className={cn("inline-block size-2.5 rounded-[3px]", DOT.neutral)} />not captured</span>
        </div>
      )}
    </div>
  );
}
