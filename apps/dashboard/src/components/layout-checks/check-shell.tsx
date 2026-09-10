"use client";

import type { ReactNode } from "react";
import { motion, useReducedMotion } from "motion/react";
import { CheckCircle2, AlertTriangle, XCircle, MinusCircle, MonitorSmartphone } from "lucide-react";
import { cn } from "@/lib/utils";
import { ms } from "@/lib/layout-checks/motion";
import type { TabVerdict } from "@/lib/layout-checks/verdict";
import { useTabSlots } from "@/components/layout-checks/site-tabs";

// The one layout both tabs share, in three bands. A command bar across the
// top: the tab control, the verdict, the run control and the history menu
// on the first line; the picker and the glance strip on the second. Then
// the device on a dark stage at the full width of the page. Then the
// findings for that ONE screenshot, in columns, under it. Colour does the
// first read — the verdict chip is tinted by its tone before a word of it
// is read — and the bands rise in staggered.

const ICON = { success: CheckCircle2, warning: AlertTriangle, error: XCircle, neutral: MinusCircle } as const;

const CHIP: Record<TabVerdict["tone"], { bg: string; icon: string; ring: string }> = {
  error:   { bg: "bg-error/[0.08]", icon: "bg-error text-white", ring: "ring-error/20" },
  warning: { bg: "bg-[rgba(245,197,163,0.35)]", icon: "bg-warning text-white", ring: "ring-warning/25" },
  success: { bg: "bg-success/[0.10]", icon: "bg-success text-white", ring: "ring-success/20" },
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

export function VerdictChip({ verdict }: { verdict: TabVerdict }) {
  const Icon = ICON[verdict.tone];
  const c = CHIP[verdict.tone];
  return (
    <div className={cn("flex min-w-0 items-center gap-2.5 rounded-xl py-1.5 pl-2 pr-3.5 ring-1", c.bg, c.ring)}>
      <span className={cn("grid size-8 shrink-0 place-items-center rounded-lg shadow-sm", c.icon)}>
        <Icon className="size-4" strokeWidth={2.25} aria-hidden />
      </span>
      <div className="min-w-0">
        <p className="text-[14px] font-semibold leading-tight tracking-tight text-text-primary">{verdict.headline}</p>
        {verdict.compare && <p className="mt-0.5 text-[11.5px] leading-tight text-text-secondary">{verdict.compare}</p>}
      </div>
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

/** A small uppercase label beside a control in the command bar. */
export function BarLabel({ children }: { children: ReactNode }) {
  return <span className="shrink-0 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-text-muted">{children}</span>;
}

export const STAGE_ID = "check-stage";

/** The findings sit under the stage, so choosing one far down the list can
 *  happen with the stage scrolled away. Bring it back — only when its top
 *  has actually left the window, so a click near the stage does not jump. */
export function revealStage() {
  const el = document.getElementById(STAGE_ID);
  if (!el || el.getBoundingClientRect().top >= 0) return;
  el.scrollIntoView({ block: "start", behavior: ms(300) === 0 ? "auto" : "smooth" });
}

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
  /** The run control, at the right of the command bar. */
  headerAction?: ReactNode;
  /** The picker line of the command bar: dropdown, glance strip, run progress. */
  picker: ReactNode;
  frame: ReactNode;
  /** The floating bar under the device: live, open, compare. */
  action?: ReactNode;
  rail: ReactNode;
  railLabel?: string;
}) {
  const slots = useTabSlots();
  return (
    <div className="@container flex flex-col gap-4">
      <Rise order={0}>
        <div className="rounded-2xl border border-border-soft bg-card shadow-xs">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-3 px-4 py-3">
            {slots?.tabs}
            <VerdictChip verdict={verdict} />
            {(headerAction || slots?.right) && (
              <div className="ml-auto flex flex-wrap items-center gap-2">
                {headerAction}
                {slots?.right}
              </div>
            )}
          </div>
          {picker && (
            <div className="flex flex-wrap items-center gap-x-5 gap-y-3 border-t border-border-soft px-4 py-3">
              {picker}
            </div>
          )}
        </div>
        {slots?.explain && <p className="mt-2 px-1 text-[13px] text-text-secondary">{slots.explain}</p>}
      </Rise>

      <div {...(slots?.panelProps ?? {})} className="flex flex-col gap-4">
        <Rise order={1}>
          <section
            id={STAGE_ID}
            aria-label="Screenshot"
            className="relative flex min-h-[560px] scroll-mt-4 flex-col overflow-hidden rounded-2xl bg-brand-primary p-5 shadow-md"
          >
            <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(184,176,240,0.28),transparent_58%),radial-gradient(ellipse_at_bottom_right,rgba(155,181,245,0.14),transparent_55%)]" />
            <div className="relative flex flex-1 flex-col items-center justify-center gap-4">{frame ?? <EmptyStage />}</div>
            {action && <div className="relative mt-5 flex justify-center">{action}</div>}
          </section>
        </Rise>

        <Rise order={2}>
          <section
            aria-label={railLabel ?? "Findings"}
            className="rounded-2xl border border-border-soft bg-card p-4 shadow-xs"
          >
            {rail}
          </section>
        </Rise>
      </div>
    </div>
  );
}
