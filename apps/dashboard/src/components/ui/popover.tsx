"use client";

import * as React from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

// A small anchored panel, Trello-style: a titled box under its trigger that
// closes on Escape, on an outside press, or when the content calls close().
// No dependency; it lives inside the dialog's scroll container, so it is
// positioned absolutely rather than portalled.

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
  const ref = React.useRef<HTMLDivElement>(null);
  const close = React.useCallback(() => setOpen(false), []);
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); close(); } };
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) close(); };
    window.addEventListener("keydown", onKey, true);
    document.addEventListener("mousedown", onDown);
    return () => { window.removeEventListener("keydown", onKey, true); document.removeEventListener("mousedown", onDown); };
  }, [open, close]);
  return (
    <div ref={ref} className="relative inline-block">
      {trigger({ open, toggle: () => setOpen((o) => !o) })}
      {open && (
        <div
          role="dialog" aria-label={title}
          className={cn("absolute top-full z-30 mt-1.5 rounded-lg border border-border-soft bg-card p-3 text-[13px] shadow-lg", width, align === "end" ? "right-0" : "left-0")}
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
      )}
    </div>
  );
}
