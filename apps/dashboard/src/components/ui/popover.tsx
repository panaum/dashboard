"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

// A small anchored panel, Trello-style: a titled box under its trigger that
// closes on Escape, on an outside press, or when the content calls close().
// No dependency. The panel is portalled to <body> and positioned from the
// trigger's rect, so it floats above the dialog's scroll box instead of
// being clipped by it, and it flips above the trigger when there is no room
// below. (A `fixed` element inside the dialog would not do: the dialog's
// motion wrapper is a transformed ancestor and would become its containing
// block — see the note on Dialog in CLAUDE.md.)

const subscribeNever = () => () => {};

export function Popover({
  trigger, title, children, align = "start", width = "w-72",
}: {
  trigger: (props: { open: boolean; toggle: () => void }) => React.ReactNode;
  title: string;
  children: (close: () => void) => React.ReactNode;
  align?: "start" | "end";
  width?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const anchor = React.useRef<HTMLDivElement>(null);
  const panel = React.useRef<HTMLDivElement>(null);
  const [pos, setPos] = React.useState<{ top: number; left?: number; right?: number; maxHeight: number } | null>(null);
  const mounted = React.useSyncExternalStore(subscribeNever, () => true, () => false);
  const close = React.useCallback(() => setOpen(false), []);

  const place = React.useCallback(() => {
    const a = anchor.current?.getBoundingClientRect(); if (!a) return;
    const gap = 6, margin = 8;
    const wanted = panel.current?.offsetHeight ?? 360;
    const below = window.innerHeight - a.bottom - margin;
    const above = a.top - margin;
    const flip = below < Math.min(wanted, 320) && above > below;
    const top = flip ? Math.max(margin, a.top - gap - wanted) : a.bottom + gap;
    const maxHeight = flip ? a.top - gap - margin : below - gap;
    const horiz = align === "end"
      ? { right: Math.max(margin, window.innerWidth - a.right) }
      : { left: Math.max(margin, Math.min(a.left, window.innerWidth - (panel.current?.offsetWidth ?? 288) - margin)) };
    setPos({ top, maxHeight: Math.max(160, maxHeight), ...horiz });
  }, [align]);

  React.useLayoutEffect(() => { if (open) place(); }, [open, place]);
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); close(); } };
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (anchor.current?.contains(t) || panel.current?.contains(t)) return;
      close();
    };
    window.addEventListener("keydown", onKey, true);
    document.addEventListener("mousedown", onDown);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, close, place]);

  const panelNode = open && pos && (
    <div
      ref={panel} role="dialog" aria-label={title}
      style={{ position: "fixed", top: pos.top, left: pos.left, right: pos.right, maxHeight: pos.maxHeight }}
      className={cn("z-[60] overflow-y-auto rounded-lg border border-border-soft bg-card p-3 text-[13px] shadow-lg", width)}
    >
      <div className="mb-2 grid grid-cols-[1.5rem_1fr_1.5rem] items-center">
        <span />
        <span className="text-center text-[12px] font-semibold text-text-secondary">{title}</span>
        <button type="button" onClick={close} aria-label="Close" className="justify-self-end rounded-md p-0.5 text-text-secondary hover:bg-card-soft hover:text-text-primary">
          <X className="size-3.5" />
        </button>
      </div>
      {children(close)}
    </div>
  );

  return (
    <div ref={anchor} className="relative inline-block">
      {trigger({ open, toggle: () => setOpen((o) => !o) })}
      {/* Measured once mounted, so the first frame may sit at the raw anchor; place() corrects it in the layout effect. */}
      {open && !pos && <div ref={panel} className={cn("invisible fixed left-0 top-0 p-3", width)} aria-hidden>{children(close)}</div>}
      {mounted && panelNode && createPortal(panelNode, document.body)}
    </div>
  );
}
