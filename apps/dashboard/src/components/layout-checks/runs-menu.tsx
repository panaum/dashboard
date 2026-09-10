"use client";

import { useEffect, useId, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ChevronDown, History } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";

// Run history, as a menu in the header rather than a table at the foot of the
// page. It is about runs, not about one screenshot, so it belongs with the
// tabs — and it is read far less often than the screenshot, so it should not
// take a screenful to exist.

export type HistoryRow = {
  id: string;
  kind: "Viewports" | "Devices";
  checkedAt: string;
  worst: string;
  summary: string;
  /** What is still on disk for this run, said before anyone clicks in. */
  kept: "all" | "folds" | "none";
};

const KEPT_NOTE: Record<HistoryRow["kept"], string | null> = {
  all: null,
  folds: "full pages not kept — folds only",
  none: "screenshots not kept",
};

const TONE: Record<string, "error" | "warning" | "neutral" | "success"> = {
  FAIL: "error", REGRESSED: "error", WARN: "warning", SKIP: "neutral", BLOCKED: "neutral", PASS: "success",
};

function when(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function RunsMenu({ rows }: { rows: HistoryRow[] }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const id = useId();
  const reduce = useReducedMotion();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: globalThis.KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);

  if (!rows.length) return null;

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "inline-flex items-center gap-2 rounded-full border border-border-soft bg-card px-4 py-2 text-[13px] font-medium text-text-secondary shadow-xs transition-colors hover:bg-card-soft hover:text-text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
          open && "bg-card-soft text-text-primary",
        )}
      >
        <History className="size-4" aria-hidden />
        History
        <span className="rounded-full bg-card-soft px-2 text-[11px] tabular-nums text-text-secondary">{rows.length}</span>
        <ChevronDown aria-hidden className={cn("size-3.5 text-text-secondary transition-transform", open && "rotate-180")} />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            id={id}
            role="dialog"
            aria-label="Run history"
            initial={reduce ? false : { opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, y: -6, scale: 0.98 }}
            transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 520, damping: 34 }}
            className="absolute right-0 top-[calc(100%+8px)] z-40 w-[min(92vw,30rem)] origin-top-right overflow-hidden rounded-2xl border border-border-soft bg-card shadow-lg"
          >
            <div className="flex items-baseline justify-between border-b border-border-soft px-4 py-2">
              <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-text-secondary">Recent runs</p>
              <p className="text-[11px] text-text-secondary">newest first</p>
            </div>
            <ol className="max-h-[22rem] divide-y divide-border-soft overflow-y-auto">
              {rows.map((r, i) => (
                <li key={`${r.kind}-${r.id}`} className="flex flex-col gap-1 px-4 py-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[13px] font-medium tabular-nums text-text-primary">{when(r.checkedAt)}</span>
                    {i === 0 && <span className="rounded-full bg-card-soft px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-text-secondary">latest</span>}
                    <span className="ml-auto flex items-center gap-2">
                      <Badge tone="neutral">{r.kind}</Badge>
                      <Badge tone={TONE[r.worst] ?? "neutral"}>{r.worst}</Badge>
                    </span>
                  </div>
                  <p className="text-[12px] text-text-secondary">{r.summary}</p>
                  {KEPT_NOTE[r.kept] && <p className="text-[11px] text-text-secondary">{KEPT_NOTE[r.kept]}</p>}
                </li>
              ))}
            </ol>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
