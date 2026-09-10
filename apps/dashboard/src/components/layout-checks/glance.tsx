"use client";

import { type KeyboardEvent } from "react";
import { cn } from "@/lib/utils";
import { rovingTarget } from "@/lib/layout-checks/roving";

// Every device or width at once, as a row of cells: red is an error, amber a
// warning, mint clean, a hollow cell not captured. Fourteen devices fit in
// a line this way, which is what the pills could never manage, and each cell
// is a button — the dropdown is for reading, this is for jumping. One tab
// stop; arrows walk the cells.

export type GlanceTone = "error" | "warning" | "success" | "neutral" | "waiting" | "captured";

export type GlanceCell = {
  id: string;
  label: string;
  tone: GlanceTone;
};

export type GlanceRow = { name: string; cells: GlanceCell[] };

const CELL: Record<GlanceTone, string> = {
  error: "bg-error shadow-[inset_0_-2px_0_rgba(0,0,0,0.12)]",
  warning: "bg-warning shadow-[inset_0_-2px_0_rgba(0,0,0,0.10)]",
  success: "bg-success/85",
  neutral: "border border-dashed border-text-muted/50 bg-transparent",
  waiting: "bg-border-soft",
  captured: "bg-accent/70",
};

export function Glance({
  rows,
  selected,
  onPick,
  label,
  legend = true,
}: {
  rows: GlanceRow[];
  selected: string | null;
  onPick: (id: string) => void;
  label: string;
  legend?: boolean;
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
  return (
    <div className="rounded-2xl border border-border-soft bg-card p-3.5 shadow-xs" role="group" aria-label={label} onKeyDown={onKey}>
      <div className="flex flex-col gap-2">
        {rows.map((r) => (
          <div key={r.name} className="flex items-center gap-3">
            <span className="w-14 shrink-0 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-text-muted">{r.name}</span>
            <div className="flex flex-wrap gap-1">
              {r.cells.map((c) => {
                const on = c.id === selected;
                return (
                  <button
                    key={c.id}
                    id={`glance-${c.id}`}
                    type="button"
                    aria-label={c.label}
                    aria-pressed={on}
                    tabIndex={c.id === tabTarget ? 0 : -1}
                    title={c.label}
                    onClick={() => onPick(c.id)}
                    className={cn(
                      "size-5 rounded-[5px] transition-[transform,box-shadow,background-color] duration-200 hover:scale-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
                      CELL[c.tone],
                      on && "scale-110 ring-2 ring-accent ring-offset-2 ring-offset-card",
                    )}
                  />
                );
              })}
            </div>
          </div>
        ))}
      </div>
      {legend && (
        <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 border-t border-border-soft pt-2.5 text-[10.5px] text-text-muted">
          <span className="flex items-center gap-1"><i className={cn("inline-block size-2.5 rounded-[3px]", CELL.error)} />errors</span>
          <span className="flex items-center gap-1"><i className={cn("inline-block size-2.5 rounded-[3px]", CELL.warning)} />warnings</span>
          <span className="flex items-center gap-1"><i className={cn("inline-block size-2.5 rounded-[3px]", CELL.success)} />clean</span>
          <span className="flex items-center gap-1"><i className={cn("inline-block size-2.5 rounded-[3px]", CELL.neutral)} />not captured</span>
        </div>
      )}
    </div>
  );
}
