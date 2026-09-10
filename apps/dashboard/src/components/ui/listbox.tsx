"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

// A dropdown that picks one thing from a list, built on the listbox pattern
// rather than a native <select> because a row here carries more than a word:
// a second line, a severity, sometimes a badge. Grouped headers are allowed.
//
// Keyboard, closed: Up/Down change the value directly, as a native select
// does; Enter, Space or Down open it. Open: Up/Down/Home/End move, Enter
// picks, Escape closes and returns focus. Click-outside closes.

export type ListTone = "error" | "warning" | "success" | "neutral" | "info";

export type ListOption = {
  id: string;
  label: string;
  /** Second line: a viewport, an engine, a shape. */
  sub?: string;
  tone?: ListTone;
  /** A short uppercase tag on the right of the row. */
  badge?: string;
  /** Rows with the same group get one header between them. */
  group?: string;
};

const DOT: Record<ListTone, string> = {
  error: "bg-error", warning: "bg-warning", success: "bg-success",
  neutral: "bg-text-muted/40", info: "bg-info",
};

export function Listbox({
  label,
  options,
  value,
  onChange,
  placeholder = "Choose…",
  className,
  triggerClassName,
}: {
  /** Accessible name for the control. */
  label: string;
  options: ListOption[];
  value: string | null;
  onChange: (id: string) => void;
  placeholder?: string;
  className?: string;
  triggerClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const listId = useId();
  const reduce = useReducedMotion();

  const ids = options.map((o) => o.id);
  const selected = options.find((o) => o.id === value) ?? null;

  const step = (from: string | null, delta: number) => {
    const i = from ? ids.indexOf(from) : -1;
    return ids[Math.min(ids.length - 1, Math.max(0, i + delta))] ?? null;
  };

  const show = () => { setActive(value ?? ids[0] ?? null); setOpen(true); };
  const hide = (refocus = true) => { setOpen(false); if (refocus) trigger.current?.focus(); };
  const choose = (id: string) => { onChange(id); hide(); };

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onDown);
    list.current?.focus();
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  useEffect(() => {
    if (!open || !active) return;
    document.getElementById(`${listId}-${active}`)?.scrollIntoView({ block: "nearest" });
  }, [open, active, listId]);

  const onTriggerKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (open) return;
      const next = step(value, e.key === "ArrowDown" ? 1 : -1);
      if (next && next !== value) onChange(next);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (open) hide(); else show();
    } else if (e.key === "Escape" && open) {
      hide();
    }
  };

  const onListKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => step(a ?? value, e.key === "ArrowDown" ? 1 : -1));
    } else if (e.key === "Home") { e.preventDefault(); setActive(ids[0] ?? null); }
    else if (e.key === "End") { e.preventDefault(); setActive(ids[ids.length - 1] ?? null); }
    else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); if (active) choose(active); }
    else if (e.key === "Escape") { e.preventDefault(); hide(); }
    else if (e.key === "Tab") { hide(false); }
  };

  return (
    <div ref={root} className={cn("relative", className)}>
      <button
        ref={trigger}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-label={label}
        onClick={() => (open ? hide() : show())}
        onKeyDown={onTriggerKey}
        className={cn(
          "flex w-full items-center gap-3 rounded-xl border border-border-soft bg-card px-4 py-2 text-left shadow-xs transition-[border-color,box-shadow] hover:border-accent/40 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent",
          open && "border-accent/50",
          triggerClassName,
        )}
      >
        {selected?.tone && <span aria-hidden className={cn("size-2.5 shrink-0 rounded-full", DOT[selected.tone])} />}
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-[13px] font-semibold text-text-primary">
            {selected?.label ?? placeholder}
          </span>
          {selected?.sub && <span className="truncate text-[11px] text-text-secondary">{selected.sub}</span>}
        </span>
        {selected?.badge && (
          <span className="shrink-0 rounded-md bg-card-soft px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-text-secondary">
            {selected.badge}
          </span>
        )}
        <ChevronDown aria-hidden className={cn("size-4 shrink-0 text-text-secondary transition-transform", open && "rotate-180")} />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            ref={list}
            id={listId}
            role="listbox"
            tabIndex={-1}
            aria-label={label}
            aria-activedescendant={active ? `${listId}-${active}` : undefined}
            onKeyDown={onListKey}
            initial={reduce ? false : { opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, y: -6, scale: 0.98 }}
            transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 520, damping: 34 }}
            className="absolute inset-x-0 top-[calc(100%+8px)] z-40 max-h-80 origin-top overflow-y-auto rounded-xl border border-border-soft bg-card p-2 shadow-lg outline-none"
          >
            {options.map((o, i) => {
              const header = o.group && o.group !== options[i - 1]?.group;
              const isActive = o.id === active;
              const isSelected = o.id === value;
              return (
                <div key={o.id}>
                  {header && (
                    <div role="presentation" className={cn("px-3 pb-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-text-secondary", i > 0 && "mt-2 border-t border-border-soft pt-2")}>
                      {o.group}
                    </div>
                  )}
                  <div
                    id={`${listId}-${o.id}`}
                    role="option"
                    aria-selected={isSelected}
                    onMouseDown={(e) => e.preventDefault()}
                    onMouseEnter={() => setActive(o.id)}
                    onClick={() => choose(o.id)}
                    className={cn(
                      "flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 transition-colors",
                      isActive ? "bg-accent/10" : "hover:bg-card-soft",
                    )}
                  >
                    <span aria-hidden className={cn("size-2 shrink-0 rounded-full", o.tone ? DOT[o.tone] : "bg-transparent")} />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className={cn("truncate text-[13px] font-medium", isSelected ? "text-accent" : "text-text-primary")}>{o.label}</span>
                      {o.sub && <span className="truncate text-[11px] text-text-secondary">{o.sub}</span>}
                    </span>
                    {o.badge && (
                      <span className="shrink-0 rounded bg-card-soft px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-text-secondary">{o.badge}</span>
                    )}
                    {isSelected && <Check aria-hidden className="size-4 shrink-0 text-accent" />}
                  </div>
                </div>
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
