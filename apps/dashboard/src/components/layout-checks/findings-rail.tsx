"use client";

import { CheckCircle2, Check, Copy } from "lucide-react";
import { useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { explain } from "@/lib/layout-checks/explain";
import { ms } from "@/lib/layout-checks/motion";
import { RAIL_CAP, railSlice, type RailFinding } from "@/lib/layout-checks/findings-view";
import { pinNumber, pinsFor, type Pin } from "@/lib/layout-checks/pins";
import { reachLabel, reachTone, type Reach } from "@/lib/layout-checks/reach";
import { allFindingsText, findingText, type CopyFinding } from "@/lib/layout-checks/copy-finding";

export type RailItem = RailFinding & {
  tag?: string;
  /** Shown under the row while it is selected. The width findings carry a
      sentence worth reading; the device findings do not have one. */
  detail?: string;
};

// The findings for ONE screenshot, never all of them. Severity is a colour
// on the whole row, not a dot: a red-edged row is an error before it is read.
// Capped at five with a quiet expander; a mint tile when there is nothing to
// say. The list sits under the stage at the page's full width, so it runs in
// columns where there is room.
//
// Three things tie it to the work rather than to the report. A number, shared
// with the pin drawn at that spot on the screenshot, so the list and the
// picture are the same index. A reach chip — "9 of 14 devices" — which is
// what decides whether this is a site-wide fix or one device's quirk. And a
// copy button, because where a finding actually goes is a ticket or Slack.

const ROW: Record<RailFinding["severity"], { bar: string; on: string; chip: string; pin: string; word: string }> = {
  error: { bar: "bg-error", on: "bg-error/[0.07] ring-error/25", chip: "bg-error/12 text-error", pin: "bg-error", word: "Error" },
  warn:  { bar: "bg-warning", on: "bg-warning/[0.09] ring-warning/30", chip: "bg-warning/15 text-warning", pin: "bg-warning", word: "Warning" },
  info:  { bar: "bg-text-muted/40", on: "bg-card-soft ring-border-soft", chip: "bg-card-soft text-text-secondary", pin: "bg-text-muted", word: "Note" },
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

/** Writes to the clipboard and says so for a moment. Failure is reported, not swallowed. */
function CopyButton({ text, label, className }: { text: string; label: string; className?: string }) {
  const [state, setState] = useState<"idle" | "done" | "failed">("idle");
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setState("done");
    } catch {
      setState("failed");
    }
    window.setTimeout(() => setState("idle"), 1800);
  };
  return (
    <button
      type="button"
      onClick={copy}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border border-border-soft px-2.5 py-1 text-[11.5px] font-medium text-text-secondary transition-colors hover:border-accent/40 hover:text-text-primary focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent",
        state === "done" && "border-success/40 text-success",
        state === "failed" && "border-error/40 text-error",
        className,
      )}
    >
      {state === "done" ? <Check className="size-3.5" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
      {state === "done" ? "Copied" : state === "failed" ? "Copy failed" : label}
    </button>
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
  where,
  url,
  reachOf,
  showPins = true,
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
  /** "Samsung Galaxy S25 · Chromium · 412 × 892" — the "where" a copied finding carries. */
  where?: string;
  /** The page under test; a copied finding is useless without it. */
  url?: string;
  /** How many audited devices carry this same finding. */
  reachOf?: (item: RailItem) => Reach | null;
  /** Numbers, matching the pins drawn on the capture. Off where nothing is drawn. */
  showPins?: boolean;
}) {
  // The same numbering the pins use, from the same pure function, so a row
  // and its marker can never disagree.
  const pins: Pin[] = showPins ? pinsFor(items, drawableHeight) : [];

  const copyOne = (it: RailItem): string => {
    const help = explain(kind, it.rule);
    const f: CopyFinding = {
      label: it.label, message: it.detail || it.message, selector: it.selector, pageLevel: it.pageLevel,
      where: where ?? deviceLabel, why: help?.why, fix: help?.fix, pin: pinNumber(pins, it.id), severity: it.severity,
    };
    return findingText(f, url ?? "");
  };
  const copyAll = (): string => allFindingsText(
    items.map((it) => {
      const help = explain(kind, it.rule);
      return { label: it.label, message: it.detail || it.message, selector: it.selector, pageLevel: it.pageLevel,
               where: where ?? deviceLabel, why: help?.why, fix: help?.fix, pin: pinNumber(pins, it.id), severity: it.severity };
    }),
    url ?? "", where ?? deviceLabel,
  );

  const head = heading ?? (
    <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border-soft pb-3">
      <p className="text-[11.5px] font-semibold uppercase tracking-[0.08em] text-text-muted">Findings</p>
      <p className="truncate text-[12.5px] font-medium text-text-secondary">{deviceLabel}</p>
      {items.length > 0 && <Summary items={items} />}
      {items.length > 0 && url && (
        <CopyButton text={copyAll()} label="Copy all" className="ml-auto" />
      )}
    </div>
  );

  if (!items.length) {
    return (
      <div className="flex flex-col">
        {head}
        {/* One sentence. A sentence does not need a box inside a box. */}
        <p className="flex items-center gap-2 text-[13.5px] font-medium leading-snug text-success-strong">
          <CheckCircle2 className="size-5 shrink-0" strokeWidth={2} aria-hidden />
          Nothing to fix on {deviceLabel}
        </p>
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
          const n = pinNumber(pins, it.id);
          const reach = reachOf?.(it) ?? null;
          const reachWords = reachLabel(reach);
          const wide = reachTone(reach) === "wide";
          // The finding has a measured place on the page; what is missing is
          // the image to draw it on. Say that, and do not offer a click that
          // would draw nothing.
          const notStored = it.box !== null && drawableHeight !== null && it.box.y >= drawableHeight;
          if (notStored) {
            return (
              <li key={it.id} id={`finding-${it.id}`} className="relative flex flex-col items-start gap-0.5 rounded-lg py-2 pl-4 pr-2.5 opacity-80">
                <span aria-hidden className={cn("absolute inset-y-2 left-0 w-[3px] rounded-full", s.bar)} />
                <span className="text-[13px] font-medium leading-snug text-text-secondary">{it.label}</span>
                <span className="font-mono text-[11px] leading-snug text-text-muted">{it.selector ?? "—"}</span>
                <span className="text-[10.5px] text-text-muted/80">full page not stored for this run</span>
              </li>
            );
          }
          const help = on ? explain(kind, it.rule) : null;
          return (
            <li key={it.id} id={`finding-${it.id}`}
                className={cn("scroll-mt-4 rounded-lg transition-[background-color,box-shadow] duration-200", on && cn("ring-1 ring-inset", s.on))}>
              <button
                type="button"
                aria-pressed={on}
                onClick={() => onSelect(it.id)}
                className={cn(
                  "relative flex w-full flex-col items-start gap-0.5 rounded-lg py-2 pl-4 pr-2.5 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent",
                  n !== null && "pl-9",
                  !on && "hover:bg-card-soft",
                )}
              >
                <span aria-hidden className={cn("absolute inset-y-2 left-0 w-[3px] rounded-full", s.bar)} />
                {/* The number is the tie to the screenshot: this row is that pin. */}
                {n !== null && (
                  <span aria-hidden className={cn(
                    "absolute left-2.5 top-2 grid size-[18px] place-items-center rounded-full text-[10px] font-bold tabular-nums text-white",
                    s.pin, on && "ring-2 ring-accent/40")}>
                    {n}
                  </span>
                )}
                <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] font-medium leading-snug text-text-primary">
                  <span className="sr-only">{s.word}{n !== null ? `, finding ${n}` : ""}: </span>
                  {it.label}
                  {it.tag && (
                    <span className="whitespace-nowrap rounded bg-accent/10 px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide text-accent">{it.tag}</span>
                  )}
                  {reachWords && (
                    <span className={cn(
                      "whitespace-nowrap rounded px-1.5 py-px text-[10px] font-semibold",
                      wide ? "bg-accent/10 text-accent" : "bg-card-soft text-text-secondary")}>
                      {reachWords}
                    </span>
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
                  <div className={cn("mb-3 mt-0.5 flex flex-col items-start gap-1.5 text-[11.5px] leading-relaxed", n !== null ? "ml-9 mr-4" : "mx-4")}>
                    {(it.detail || it.message) && (
                      <p className="text-text-primary">{it.detail || it.message}</p>
                    )}
                    {help && <p className="text-text-secondary">{help.why}</p>}
                    {help?.fix && <p className="text-text-muted">{help.fix}</p>}
                    {!help && !it.detail && !it.message && (
                      <p className="text-text-muted">No further detail was recorded for this finding.</p>
                    )}
                    {/* Rendered only while the row is open: a collapsed row is
                        clipped to nothing, and a control clipped to nothing is
                        still a control — reachable by tooling, confusing to
                        everyone. Nothing there is better than inert. */}
                    {on && url && <CopyButton text={copyOne(it)} label="Copy for the developer" className="mt-0.5" />}
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
