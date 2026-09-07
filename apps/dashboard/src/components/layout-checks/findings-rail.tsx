"use client";

import { CheckCircle2 } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { RAIL_CAP, railSlice, type RailFinding } from "@/lib/layout-checks/findings-view";

export type RailItem = RailFinding & { tag?: string };

// The findings for ONE screenshot, never all of them. One line each — a dot,
// four or five words, the selector beneath in mono — capped at five with a
// quiet expander, and a green check with nothing else when there is nothing
// to say. Clicking a line selects it and (if it has a place on the page)
// draws the highlight box in the frame.

const DOT: Record<RailFinding["severity"], string> = { error: "bg-error", warn: "bg-warning", info: "bg-text-muted/50" };

export function FindingsRail({
  deviceLabel,
  items,
  heading,
  selectedId,
  onSelect,
  expanded,
  onToggle,
  drawableHeight,
}: {
  deviceLabel: string;
  items: RailItem[];
  /** Optional section header, used in engine comparison. */
  heading?: ReactNode;
  selectedId: string | null;
  onSelect: (id: string) => void;
  expanded: boolean;
  onToggle: () => void;
  /** Height of the loaded screenshot in CSS px; a box below it cannot be drawn. */
  drawableHeight: number | null;
}) {
  if (!items.length) {
    return (
      <div className="flex flex-col">
        {heading}
        <p className="flex items-center gap-2 py-1 text-[13.5px] font-medium text-text-primary">
          <CheckCircle2 className="size-5 text-success" strokeWidth={2} aria-hidden />
          No issues on {deviceLabel}
        </p>
      </div>
    );
  }
  const { shown, hidden } = railSlice(items, expanded);
  return (
    <div className="flex flex-col">
      {heading}
      <ul className="flex flex-col" aria-label={`Findings on ${deviceLabel}`}>
        {shown.map((it) => {
          const on = it.id === selectedId;
          // The finding has a measured place on the page; what is missing is
          // the image to draw it on. Say that, and do not offer a click that
          // would draw nothing.
          const notStored = it.box !== null && drawableHeight !== null && it.box.y >= drawableHeight;
          if (notStored) {
            return (
              <li key={it.id} className="flex flex-col items-start gap-0.5 px-2.5 py-2">
                <span className="flex items-center gap-2 text-[13px] font-medium leading-snug text-text-secondary">
                  <span aria-hidden className={cn("inline-block size-2 shrink-0 rounded-full opacity-70", DOT[it.severity])} />
                  {it.label}
                </span>
                <span className="pl-4 font-mono text-[11px] leading-snug text-text-muted">{it.selector ?? "—"}</span>
                <span className="pl-4 text-[10.5px] text-text-muted/80">full page not stored for this run</span>
              </li>
            );
          }
          return (
            <li key={it.id}>
              <button
                type="button"
                aria-pressed={on}
                onClick={() => onSelect(it.id)}
                className={cn(
                  "flex w-full flex-col items-start gap-0.5 rounded-lg px-2.5 py-2 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent",
                  on ? "bg-accent/10 ring-1 ring-inset ring-accent/20" : "hover:bg-card-soft",
                )}
              >
                <span className="flex items-center gap-2 text-[13px] font-medium leading-snug text-text-primary">
                  <span aria-hidden className={cn("inline-block size-2 shrink-0 rounded-full", DOT[it.severity])} />
                  <span className="sr-only">{it.severity === "error" ? "Error: " : it.severity === "warn" ? "Warning: " : "Note: "}</span>
                  {it.label}
                  {it.tag && (
                    <span className="ml-1 whitespace-nowrap rounded bg-accent/10 px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide text-accent">{it.tag}</span>
                  )}
                </span>
                <span className="pl-4 font-mono text-[11px] leading-snug text-text-muted">
                  {it.pageLevel ? "whole page" : (it.selector ?? "—")}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {(hidden > 0 || (expanded && items.length > RAIL_CAP)) && (
        <button
          type="button"
          onClick={onToggle}
          className="mt-1 self-start rounded-md px-2.5 py-1 text-[12px] text-text-muted transition-colors hover:bg-card-soft hover:text-text-primary focus-visible:outline-2 focus-visible:outline-accent"
        >
          {hidden > 0 ? `${hidden} more` : "Show fewer"}
        </button>
      )}
    </div>
  );
}
