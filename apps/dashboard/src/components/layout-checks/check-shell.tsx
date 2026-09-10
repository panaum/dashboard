"use client";

import type { ReactNode } from "react";
import { motion, useReducedMotion } from "motion/react";
import { CheckCircle2, AlertTriangle, XCircle, MinusCircle, MonitorSmartphone } from "lucide-react";
import { cn } from "@/lib/utils";
import type { TabVerdict } from "@/lib/layout-checks/verdict";

// The one layout both tabs share, arranged as a stage: the verdict and the
// picker on the left, the device on a dark stage in the middle where it can be
// large, and the findings for that ONE screenshot on the right. Below xl the
// findings drop under the stage; on a phone everything stacks. Colour does
// the first read — the verdict card is tinted by its tone before a word of
// it is read — and the panels rise in on mount, staggered.

const ICON = { success: CheckCircle2, warning: AlertTriangle, error: XCircle, neutral: MinusCircle } as const;

const CARD: Record<TabVerdict["tone"], { bg: string; icon: string; ring: string }> = {
  error:   { bg: "bg-[linear-gradient(135deg,rgba(224,92,92,0.14),rgba(224,92,92,0.04)_60%,transparent)]", icon: "bg-error text-white", ring: "ring-error/20" },
  warning: { bg: "bg-[linear-gradient(135deg,rgba(245,197,163,0.55),rgba(249,232,160,0.25)_60%,transparent)]", icon: "bg-warning text-white", ring: "ring-warning/25" },
  success: { bg: "bg-[linear-gradient(135deg,rgba(76,175,125,0.16),rgba(76,175,125,0.04)_60%,transparent)]", icon: "bg-success text-white", ring: "ring-success/20" },
  neutral: { bg: "bg-card-soft", icon: "bg-text-muted/30 text-text-primary", ring: "ring-border-soft" },
};

/** Fade-and-rise on mount, staggered by `order`. Nothing when motion is reduced. */
export function Rise({ order = 0, className, children }: { order?: number; className?: string; children: ReactNode }) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.36, delay: order * 0.07, ease: [0.22, 1, 0.36, 1] }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

export function VerdictCard({ verdict, action }: { verdict: TabVerdict; action?: ReactNode }) {
  const Icon = ICON[verdict.tone];
  const c = CARD[verdict.tone];
  return (
    <div className={cn("relative overflow-hidden rounded-2xl bg-card p-5 shadow-sm ring-1", c.bg, c.ring)}>
      <div className="flex items-start gap-3.5">
        <span className={cn("grid size-10 shrink-0 place-items-center rounded-xl shadow-sm", c.icon)}>
          <Icon className="size-5" strokeWidth={2.25} aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[19px] font-semibold leading-tight tracking-tight text-text-primary text-balance">
            {verdict.headline}
          </p>
          {verdict.compare && <p className="mt-1.5 text-[12.5px] leading-snug text-text-secondary">{verdict.compare}</p>}
        </div>
      </div>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/** The floating control bar under the device, on the dark stage. */
export function StageBar({ children, note }: { children: ReactNode; note?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2">
      <div className="inline-flex flex-wrap items-center justify-center gap-1 rounded-full bg-white/[0.08] p-1 ring-1 ring-white/10 backdrop-blur-md">
        {children}
      </div>
      {note && <p className="max-w-sm text-center text-[12px] text-white/60">{note}</p>}
    </div>
  );
}

/** A button on the stage bar. `on` is the pressed state, drawn in the accent. */
export function StageButton({
  on = false, children, className, ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { on?: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={rest["aria-pressed"] ?? (on || undefined)}
      {...rest}
      className={cn(
        "inline-flex h-9 items-center gap-1.5 rounded-full px-3.5 text-[13px] font-medium transition-[background-color,color,transform] duration-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-purple disabled:opacity-50 active:scale-[0.98]",
        on ? "bg-accent text-white shadow-brand" : "text-white/85 hover:bg-white/10 hover:text-white",
        className,
      )}
    >
      {children}
    </button>
  );
}

/** Text under the device on the stage: the name bright, the rest dimmed. */
export function StageCaption({ title, children }: { title: ReactNode; children?: ReactNode }) {
  return (
    <p className="max-w-md text-center text-[12.5px] leading-snug text-white/55">
      <span className="font-medium text-white/90">{title}</span>
      {children}
    </p>
  );
}

/** Classes for a DeviceFrame sitting on the stage: a faint rim so a dark bezel reads against navy. */
export const ON_STAGE = "ring-1 ring-white/[0.14] shadow-[0_30px_80px_-24px_rgba(0,0,0,0.7)]";

function EmptyStage() {
  return (
    <div className="flex flex-col items-center gap-3 text-center">
      <span className="grid size-14 place-items-center rounded-2xl bg-white/[0.06] ring-1 ring-white/10">
        <MonitorSmartphone className="size-7 text-brand-purple" aria-hidden />
      </span>
      <p className="text-[14px] font-medium text-white/80">Nothing to show yet</p>
      <p className="max-w-xs text-[12.5px] leading-snug text-white/50">Run the check and the page appears here, on the device you pick.</p>
    </div>
  );
}

export function CheckShell({
  verdict,
  headerAction,
  picker,
  frame,
  action,
  rail,
  railLabel,
}: {
  verdict: TabVerdict;
  /** The run control, inside the verdict card. */
  headerAction?: ReactNode;
  picker: ReactNode;
  frame: ReactNode;
  /** The floating bar under the device: live, open, compare. */
  action?: ReactNode;
  rail: ReactNode;
  railLabel?: string;
}) {
  // Columns follow the width this shell actually has, not the window's: the
  // sidebar and the page's max width decide that, and a viewport breakpoint
  // cannot see either. Two columns from 768px of room, three from 1152px.
  return (
    <div className="@container">
    <div className="grid gap-4 @3xl:grid-cols-[280px_minmax(0,1fr)] @6xl:grid-cols-[300px_minmax(0,1fr)_340px]">
      <Rise order={0} className="flex min-w-0 flex-col gap-4">
        <VerdictCard verdict={verdict} action={headerAction} />
        {picker}
      </Rise>

      <Rise order={1} className="min-w-0">
        <section
          aria-label="Screenshot"
          className="relative flex h-full min-h-[640px] flex-col overflow-hidden rounded-2xl bg-brand-primary p-5 shadow-md"
        >
          <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(184,176,240,0.28),transparent_58%),radial-gradient(ellipse_at_bottom_right,rgba(155,181,245,0.14),transparent_55%)]" />
          <div className="relative flex flex-1 flex-col items-center justify-center gap-4">{frame ?? <EmptyStage />}</div>
          {action && <div className="relative mt-5 flex justify-center">{action}</div>}
        </section>
      </Rise>

      <Rise order={2} className="min-w-0 @3xl:col-span-2 @6xl:col-span-1">
        <aside
          className="flex h-full min-w-0 flex-col rounded-2xl border border-border-soft bg-card p-4 shadow-xs"
          aria-label={railLabel ?? "Findings"}
        >
          {rail}
        </aside>
      </Rise>
    </div>
    </div>
  );
}
