"use client";

import { Check, CheckCircle2, Copy, Image as ImageIcon, Wand2 } from "lucide-react";
import { useState, type CSSProperties, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { explain } from "@/lib/layout-checks/explain";
import { ms } from "@/lib/layout-checks/motion";
import { RAIL_CAP, railSlice, type RailFinding } from "@/lib/layout-checks/findings-view";
import { SectionHeading } from "@/components/layout-checks/check-shell";
import { pinNumber, pinsFor, type Pin } from "@/lib/layout-checks/pins";
import { undrawnLabel, type Hold } from "@/lib/layout-checks/capture-hold";
import { fixPrompt } from "@/lib/layout-checks/fix-prompt";
import { imagePlan, INK } from "@/lib/layout-checks/finding-image";
import { reachLabel, reachTone, type Reach } from "@/lib/layout-checks/reach";
import { allFindingsText, findingText, type CopyFinding } from "@/lib/layout-checks/copy-finding";
import { boxWithin, cropFor, cropStyle, type Box } from "@/lib/layout-checks/crop";
import { checkFor } from "@/lib/layout-checks/matrix";
import { viewLink } from "@/lib/layout-checks/deep-link";

// The open row's picture, sized for the rail's inner width.
// Every thumbnail in the column, at every state.
const THUMB_W = 88;
const THUMB_H = 64;

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

// Severity is the bar and the pin. Where it is spelled out in words, the
// words take the darkened hue — the fill hues fail AA as 11px text — and no
// box: a count or a severity is a word in a line, not a pill.
const ROW: Record<RailFinding["severity"], { bar: string; text: string; pin: string; word: string }> = {
  error: { bar: "bg-error", text: "text-error-strong", pin: "bg-error-strong", word: "Error" },
  warn:  { bar: "bg-warning", text: "text-warning-strong", pin: "bg-warning-strong", word: "Warning" },
  info:  { bar: "bg-text-muted/40", text: "text-text-primary", pin: "bg-text-secondary", word: "Note" },
};

function Summary({ items }: { items: RailItem[] }) {
  const n = (s: RailFinding["severity"]) => items.filter((i) => i.severity === s).length;
  const parts: { k: RailFinding["severity"]; n: number; label: string }[] = [
    { k: "error" as const, n: n("error"), label: "error" },
    { k: "warn" as const, n: n("warn"), label: "warning" },
    { k: "info" as const, n: n("info"), label: "note" },
  ].filter((p) => p.n > 0);
  return (
    <span className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[13px] text-text-secondary">
      {parts.map((p) => (
        <span key={p.k}>
          <span className={cn("font-semibold tabular-nums", ROW[p.k].text)}>{p.n}</span> {p.label}{p.n === 1 ? "" : "s"}
        </span>
      ))}
    </span>
  );
}

/** Writes to the clipboard and says so for a moment. Failure is reported, not swallowed. */
function CopyButton({ text, label, className, icon, title }: {
  text: string; label: string; className?: string; icon?: ReactNode; title?: string;
}) {
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
      title={title}
      className={cn(
        "inline-flex h-8 items-center gap-2 rounded-full border border-border-soft px-4 text-[11px] font-medium text-text-secondary transition-colors hover:bg-card hover:text-text-primary focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-text-primary",
        state === "done" && "border-success/40 text-success-strong",
        state === "failed" && "border-error/40 text-error-strong",
        className,
      )}
    >
      {state === "done" ? <Check className="size-3.5" aria-hidden /> : (icon ?? <Copy className="size-3.5" aria-hidden />)}
      {state === "done" ? "Copied" : state === "failed" ? "Copy failed" : label}
    </button>
  );
}

// The row's picture, larger, on the clipboard: the element outlined on the
// page around it with its number, and a line underneath saying what and
// where — so it explains itself in the chat or the ticket it lands in. Drawn
// from the same capture the row's thumbnail is cut from, which is our own
// route, so the canvas is not tainted and can be read back out.
//
// The ClipboardItem is created inside the click with a promise for its data:
// the drawing needs the image to load first, and Safari only honours a write
// that was started by the gesture.
function CopyImageButton({ src, box, pageWidth, pageHeight, pin, severity, caption }: {
  src: string; box: Box; pageWidth: number; pageHeight: number | null;
  pin: number | null; severity: RailFinding["severity"]; caption: string;
}) {
  const [state, setState] = useState<"idle" | "done" | "failed">("idle");
  const render = async (): Promise<Blob> => {
    const img = new window.Image();
    img.decoding = "async";
    await new Promise<void>((ok, fail) => { img.onload = () => ok(); img.onerror = () => fail(new Error("capture")); img.src = src; });
    const plan = imagePlan(box, { width: pageWidth, height: pageHeight }, { width: img.naturalWidth, height: img.naturalHeight });
    if (!plan) throw new Error("below the capture");
    const BAR = 44;
    const canvas = document.createElement("canvas");
    canvas.width = plan.width; canvas.height = plan.height + BAR;
    const g = canvas.getContext("2d");
    if (!g) throw new Error("canvas");
    g.fillStyle = "#ffffff"; g.fillRect(0, 0, canvas.width, canvas.height);
    g.imageSmoothingQuality = "high";
    g.drawImage(img, plan.source.x, plan.source.y, plan.source.width, plan.source.height, 0, 0, plan.width, plan.height);
    // The outline: ink over a white halo, so it reads on any page.
    const o = plan.outline;
    g.lineWidth = 6; g.strokeStyle = "rgba(255,255,255,0.9)"; g.strokeRect(o.left - 2, o.top - 2, Math.max(8, o.width + 4), Math.max(8, o.height + 4));
    g.lineWidth = 2.5; g.strokeStyle = INK[severity]; g.strokeRect(o.left - 2, o.top - 2, Math.max(8, o.width + 4), Math.max(8, o.height + 4));
    if (pin !== null) {
      const r = 13, cx = Math.max(r + 2, plan.pin.x), cy = Math.max(r + 2, plan.pin.y);
      g.beginPath(); g.arc(cx, cy, r + 2, 0, Math.PI * 2); g.fillStyle = "#ffffff"; g.fill();
      g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fillStyle = INK[severity]; g.fill();
      g.fillStyle = "#ffffff"; g.font = "bold 13px system-ui, sans-serif"; g.textAlign = "center"; g.textBaseline = "middle";
      g.fillText(String(pin), cx, cy + 0.5);
    }
    // The line under the picture: what this is and where it was measured.
    g.fillStyle = "#ffffff"; g.fillRect(0, plan.height, canvas.width, BAR);
    g.fillStyle = "#e6e6ee"; g.fillRect(0, plan.height, canvas.width, 1);
    g.fillStyle = "#1c1c2e"; g.font = "600 14px system-ui, sans-serif"; g.textAlign = "left"; g.textBaseline = "middle";
    g.fillText(caption, 16, plan.height + BAR / 2, canvas.width - 32);
    return new Promise<Blob>((ok, fail) => canvas.toBlob((b) => (b ? ok(b) : fail(new Error("png"))), "image/png"));
  };
  const copy = async () => {
    try {
      await navigator.clipboard.write([new ClipboardItem({ "image/png": render() })]);
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
      title="The element outlined on the page around it, as a picture — for Slack or a ticket."
      className={cn(
        "inline-flex h-8 items-center gap-2 rounded-full border border-border-soft px-4 text-[11px] font-medium text-text-secondary transition-colors hover:bg-card hover:text-text-primary focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-text-primary",
        state === "done" && "border-success/40 text-success-strong",
        state === "failed" && "border-error/40 text-error-strong",
      )}
    >
      {state === "done" ? <Check className="size-3.5" aria-hidden /> : <ImageIcon className="size-3.5" aria-hidden />}
      {state === "done" ? "Copied" : state === "failed" ? "Copy failed" : "Copy as image"}
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
  hold = null,
  loading = false,
  prompt,
  where,
  url,
  reachOf,
  showPins = true,
  thumbs = null,
  alsoOn,
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
  /** Set when the capture stops short of the page's foot, which is why a box
      below it cannot be drawn — a different thing from a run whose full page
      is gone, and the row says which. */
  hold?: Hold | null;
  /** True while the frame is still fetching the capture these pictures are cut
      from. A full page is several megabytes, so this is seconds, not a flash. */
  loading?: boolean;
  /** The page's own fix prompt — every device's findings, the same fault
      counted once. The rail only knows the device it is showing, so where the
      page can build the better instruction, it passes it in. */
  prompt?: string;
  /** "Samsung Galaxy S25 · Chromium · 412 × 892" — the "where" a copied finding carries. */
  where?: string;
  /** The page under test; a copied finding is useless without it. */
  url?: string;
  /** How many audited devices carry this same finding. */
  reachOf?: (item: RailItem) => Reach | null;
  /** Numbers, matching the pins drawn on the capture. Off where nothing is drawn. */
  showPins?: boolean;
  /** The capture the frame is showing, so a row can carry a crop of its
      element. `src` is null until the frame has one. */
  thumbs?: { src: string | null; pageWidth: number; pageHeight: number | null } | null;
  /** The other devices carrying this same finding, by name. */
  alsoOn?: (item: RailItem) => string[];
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
    // The address bar already holds device and finding, so the link is this
    // page as it stands — the reader opens exactly what the sender saw.
    return findingText(f, url ?? "", viewLink({ finding: it.id }));
  };
  const copyAll = (): string => allFindingsText(
    items.map((it) => {
      const help = explain(kind, it.rule);
      return { label: it.label, message: it.detail || it.message, selector: it.selector, pageLevel: it.pageLevel,
               where: where ?? deviceLabel, why: help?.why, fix: help?.fix, pin: pinNumber(pins, it.id), severity: it.severity };
    }),
    url ?? "", where ?? deviceLabel, viewLink({ finding: null }),
  );

  // The same findings again, written for whoever builds the page rather than
  // for someone to read: most of these pages are built with an assistant, and
  // this is the shortest path from "the tool found it" to "the page is fixed".
  const copyPrompt = (): string => fixPrompt(
    items.map((it) => {
      const help = explain(kind, it.rule);
      return { label: it.label, message: it.detail || it.message, selector: it.selector,
               pageLevel: it.pageLevel, why: help?.why, fix: help?.fix, severity: it.severity,
               reach: reachLabel(reachOf?.(it) ?? null) };
    }),
    { url: url ?? "", where: where ?? deviceLabel },
  );

  // A heading and the space under it group the list; a rule across the card
  // only adds a line.
  const head = heading ?? (
    <SectionHeading label="Findings" subject={deviceLabel}>
      {items.length > 0 && <Summary items={items} />}
      {items.length > 0 && url && (
        // The two buttons stay side by side and wrap together: the rail's
        // column is not wide enough to hold them beside the counts, and one
        // button on each line reads as two unrelated controls.
        <span className="flex flex-wrap items-center gap-2">
          <CopyButton text={prompt || copyPrompt()} label="Copy fix prompt"
                      icon={<Wand2 className="size-3.5" aria-hidden />}
                      title={(prompt
                        ? "Every finding on this page, from every device, as one instruction for whoever builds it"
                        : "Every finding here as one instruction, for whoever builds the page")
                        + " — the measurements, what each costs a visitor, and the rules a fix has to respect."} />
          <CopyButton text={copyAll()} label="Copy all" title="Every finding here as plain text, to send to a person." />
        </span>
      )}
    </SectionHeading>
  );

  if (!items.length) {
    return (
      <div className="flex flex-col">
        {head}
        {/* One sentence. A sentence does not need a box inside a box. */}
        <p className="flex items-center gap-2 text-[13px] font-medium leading-snug text-success-strong">
          <CheckCircle2 className="size-5 shrink-0" strokeWidth={2} aria-hidden />
          Nothing to fix on {deviceLabel}
        </p>
      </div>
    );
  }

  const { shown, hidden } = railSlice(items, expanded, RAIL_CAP, items.findIndex((i) => i.id === selectedId));
  return (
    <div className="flex flex-col">
      {head}
      <ul className="flex flex-col gap-2" aria-label={`Findings on ${deviceLabel}`}>
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
              <li key={it.id} id={`finding-${it.id}`} className="relative flex flex-col items-start rounded-lg py-2 pl-4 pr-2 opacity-80">
                <span aria-hidden className={cn("absolute inset-y-2 left-0 w-[3px] rounded-full", s.bar)} />
                <span className="text-[13px] font-medium leading-snug text-text-secondary">{it.label}</span>
                <span className="font-mono text-[11px] leading-4 text-text-secondary">{it.selector ?? "—"}</span>
                <span className="text-[11px] text-text-secondary">{undrawnLabel(hold)}</span>
              </li>
            );
          }
          const help = on ? explain(kind, it.rule) : null;
          // A picture of the element, from the same capture the frame shows.
          // ONE picture per row, the same size and the same window on every
          // row, open or closed: a column of pictures only reads as a column
          // if they match. Opening a row adds words, not a second, larger
          // picture of the element you are already looking at — the device on
          // the stage beside this list is showing it, highlighted, full size.
          // The window is a little under half the page's width whatever the
          // element is, so a 77px link and a 372px image are not blown up by
          // different amounts.
          const crop = thumbs?.src && it.box && !it.pageLevel
            ? cropFor(it.box, thumbs.pageWidth, thumbs.pageHeight, THUMB_W, THUMB_H, 20, 140, Math.round(thumbs.pageWidth * 0.45)) : null;
          // Which of the things in that window is the finding.
          const outline = crop && it.box ? boxWithin(crop, it.box) : null;
          // The picture is cut from the capture the frame is fetching, and the
          // page's height is not known until it lands. Until then the window is
          // a guess and the box is empty, so it reads as loading rather than as
          // a picture that failed — and nothing is outlined on nothing.
          const pending = loading && thumbs?.pageHeight == null;
          const check = checkFor(it.rule);
          const others = on ? (alsoOn?.(it) ?? []) : [];
          return (
            // Selected is the accent's one job on this page.
            <li key={it.id} id={`finding-${it.id}`}
                className={cn("scroll-mt-4 rounded-lg transition-[background-color,box-shadow] duration-200", on && "bg-accent/[0.06]")}>
              <button
                type="button"
                aria-pressed={on}
                onClick={() => onSelect(it.id)}
                style={{ "--thumb": `${THUMB_W}px` } as CSSProperties}
                className={cn(
                  "relative w-full rounded-lg py-2 pl-4 pr-2 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-text-primary",
                  crop ? "grid grid-cols-[var(--thumb)_minmax(0,1fr)] items-start gap-4" : "flex flex-col items-start",
                  n !== null && !crop && "pl-8",
                  // The rail sits on the page now, not a white card, so hover
                  // lifts the row to white rather than tinting it grey.
                  !on && "hover:bg-card",
                )}
              >
                <span aria-hidden className={cn("absolute inset-y-2 left-0 w-[3px] rounded-full", s.bar)} />
                {crop && thumbs?.src ? (
                  <span aria-hidden data-thumb
                        className={cn("relative block overflow-hidden rounded-lg bg-card-soft ring-1 ring-inset ring-border-soft",
                                      pending && "motion-safe:animate-pulse")}
                        style={{ width: THUMB_W, height: THUMB_H, ...cropStyle(thumbs.src, crop, thumbs.pageWidth) }}>
                    {outline && !pending && (
                      /* White on a dark halo, so it is legible over any
                         screenshot without spending the accent, which on this
                         page means "selected" and nothing else. */
                      <span className="absolute rounded-[2px] border border-white shadow-[0_0_0_1px_rgba(0,0,0,0.55)]"
                            style={{ left: outline.left - 1, top: outline.top - 1,
                                     width: Math.max(6, outline.width + 2), height: Math.max(6, outline.height + 2) }} />
                    )}
                    {n !== null && (
                      <span className={cn("absolute left-1 top-1 grid size-[18px] place-items-center rounded-full text-[10px] font-bold tabular-nums text-white shadow-[0_0_0_2px_#fff]",
                                          s.pin, on && "ring-2 ring-accent/40")}>{n}</span>
                    )}
                  </span>
                ) : n !== null ? (
                  /* The number is the tie to the screenshot: this row is that pin. */
                  <span aria-hidden className={cn(
                    "absolute left-2 top-2 grid size-[18px] place-items-center rounded-full text-[10px] font-bold tabular-nums text-white",
                    s.pin, on && "ring-2 ring-accent/40")}>
                    {n}
                  </span>
                ) : null}
                <span className="flex min-w-0 flex-col">
                <span className="flex flex-wrap items-baseline gap-x-2 text-[13px] font-medium leading-5 text-text-primary">
                  <span className="sr-only">{s.word}{n !== null ? `, finding ${n}` : ""}: </span>
                  {it.label}
                  {/* Metadata, not selection: neutral, so the accent keeps one job. */}
                  {it.tag && (
                    <span className="whitespace-nowrap text-[11px] font-semibold uppercase tracking-wide text-text-secondary">{it.tag}</span>
                  )}
                </span>
                {/* Its own line, so every row has the same shape whatever the
                    label's length — inline, it ran beside a short label and
                    wrapped under a long one. */}
                {reachWords && (
                  <span className={cn("text-[11px] leading-4 text-text-secondary", wide ? "font-semibold" : "font-medium")}>
                    {reachWords}
                  </span>
                )}
                <span className="font-mono text-[11px] leading-4 text-text-secondary">
                  {it.pageLevel ? "whole page" : (it.selector ?? "—")}
                </span>
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
                  <div className={cn("mb-4 flex flex-col items-start gap-2 text-[12px] leading-relaxed", n !== null && !crop ? "ml-8 mr-4" : "mx-4")}>
                    <span className="flex flex-wrap items-center gap-x-4 text-[11px] font-semibold uppercase tracking-[0.08em]">
                      <span className={ROW[it.severity].text}>{s.word}</span>
                      {check && <span className="text-text-secondary">{check.label}</span>}
                    </span>
                    {(it.detail || it.message) && (
                      <p className="text-text-primary">{it.detail || it.message}</p>
                    )}
                    {help && <p className="text-text-secondary">{help.why}</p>}
                    {help?.fix && <p className="text-text-secondary">{help.fix}</p>}
                    {!help && !it.detail && !it.message && (
                      <p className="text-text-secondary">No further detail was recorded for this finding.</p>
                    )}
                    {/* Rendered only while the row is open: a collapsed row is
                        clipped to nothing, and a control clipped to nothing is
                        still a control — reachable by tooling, confusing to
                        everyone. Nothing there is better than inert. */}
                    {others.length > 0 && (
                      <span className="flex flex-col">
                        <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-text-secondary">Also on</span>
                        {/* A list of names is a sentence, not a row of boxes. */}
                        <span className="text-[12px] leading-5 text-text-primary">
                          {others.slice(0, 8).join(", ")}
                          {others.length > 8 && <span className="text-text-secondary">, and {others.length - 8} more</span>}
                        </span>
                      </span>
                    )}
                    {on && url && (
                      <span className="flex flex-wrap gap-2">
                        <CopyButton text={copyOne(it)} label="Copy for the developer" />
                        {thumbs?.src && it.box && !it.pageLevel && (
                          <CopyImageButton src={thumbs.src} box={it.box} pageWidth={thumbs.pageWidth} pageHeight={thumbs.pageHeight}
                                           pin={n} severity={it.severity}
                                           caption={`${n !== null ? `#${n} · ` : ""}${it.label}${where ? ` · ${where}` : ""}`} />
                        )}
                        <CopyButton text={viewLink({ finding: it.id }) ?? ""} label="Copy link" />
                      </span>
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
          className="mt-4 inline-flex h-8 items-center self-start rounded-full border border-border-soft px-4 text-[12px] font-medium text-text-secondary transition-colors hover:bg-card hover:text-text-primary focus-visible:outline-2 focus-visible:outline-text-primary"
        >
          {hidden > 0 ? `Show ${hidden} more` : "Show fewer"}
        </button>
      )}
    </div>
  );
}
