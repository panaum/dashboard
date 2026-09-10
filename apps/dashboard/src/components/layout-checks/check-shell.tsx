"use client";

import type { ReactNode } from "react";
import { motion, useReducedMotion } from "motion/react";
import { CheckCircle2, AlertTriangle, XCircle, MinusCircle, MonitorSmartphone } from "lucide-react";
import { cn } from "@/lib/utils";
import { ms } from "@/lib/layout-checks/motion";
import type { TabVerdict } from "@/lib/layout-checks/verdict";
import { useTabSlots } from "@/components/layout-checks/site-tabs";

// The one layout both tabs share, in three bands. A header: the tab control
// and the run controls on one line, the verdict on its own line under them,
// the picker under that. Then the device on its own surface. Then the
// findings for that ONE screenshot.
//
// The stage is a light surface, a step off the page — not a dark panel. The
// device bezel is already near-black, so it reads harder against light than
// it ever did against navy, and the page stays one product rather than two.

const ICON = { success: CheckCircle2, warning: AlertTriangle, error: XCircle, neutral: MinusCircle } as const;

// Tone on the words and the mark, never as a filled container: the verdict is
// a sentence, and a sentence in a coloured box competes with the red dots
// whose whole job is to be the loudest thing on the page.
const TONE: Record<TabVerdict["tone"], string> = {
  error: "text-error-strong",
  warning: "text-warning-strong",
  success: "text-success-strong",
  neutral: "text-text-secondary",
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

/** The two-second read: what this run says, in one sentence. */
export function VerdictLine({ verdict }: { verdict: TabVerdict }) {
  const Icon = ICON[verdict.tone];
  return (
    <div className="flex items-start gap-2.5">
      <Icon className={cn("mt-0.5 size-6 shrink-0", TONE[verdict.tone])} strokeWidth={2} aria-hidden />
      <div className="min-w-0">
        <p className={cn("text-[21px] font-semibold leading-tight tracking-tight text-balance", TONE[verdict.tone])}>
          {verdict.headline}
        </p>
        {verdict.compare && <p className="mt-1 text-[13px] leading-snug text-text-secondary">{verdict.compare}</p>}
      </div>
    </div>
  );
}

/** The control bar under the device. A row of buttons, not a container. */
export function StageBar({ children, note }: { children: ReactNode; note?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2">
      <div className="flex flex-wrap items-center justify-center gap-2">{children}</div>
      {note && <p className="max-w-sm text-center text-[12px] text-text-secondary">{note}</p>}
    </div>
  );
}

/** A button on the stage bar: neutral, filling in only on hover. The accent
 *  is reserved for what is selected, which for a toggle is its pressed state. */
export function StageButton({
  on = false, children, className, ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { on?: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={rest["aria-pressed"] ?? (on || undefined)}
      {...rest}
      className={cn(
        "inline-flex h-9 items-center gap-2 rounded-lg border px-3 text-[13px] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-50",
        on
          ? "border-accent bg-accent/10 text-accent"
          : "border-border-soft bg-card text-text-primary hover:bg-card-soft",
        className,
      )}
    >
      {children}
    </button>
  );
}

/** Text under the device: the name in full strength, the rest quieter. */
export function StageCaption({ title, children }: { title: ReactNode; children?: ReactNode }) {
  return (
    <p className="max-w-md text-center text-[13px] leading-snug text-text-secondary">
      <span className="font-medium text-text-primary">{title}</span>
      {children}
    </p>
  );
}

/** Classes for a DeviceFrame on the stage: a hairline, so the dark bezel has an edge. */
export const ON_STAGE = "ring-1 ring-border-soft";

/** A small uppercase label beside a control. */
export function BarLabel({ children }: { children: ReactNode }) {
  return <span className="shrink-0 text-[11px] font-semibold uppercase tracking-[0.08em] text-text-muted">{children}</span>;
}

export const STAGE_ID = "check-stage";

/** The findings can sit under the stage on a narrow screen, so choosing one
 *  can happen with the stage scrolled away. Bring it back — only when its top
 *  has actually left the window, so a click near the stage does not jump. */
export function revealStage() {
  const el = document.getElementById(STAGE_ID);
  if (!el || el.getBoundingClientRect().top >= 0) return;
  el.scrollIntoView({ block: "start", behavior: ms(300) === 0 ? "auto" : "smooth" });
}

function EmptyStage() {
  return (
    <div className="flex flex-col items-center gap-3 text-center">
      <MonitorSmartphone className="size-8 text-text-muted" aria-hidden />
      <p className="text-[14px] font-medium text-text-secondary">Nothing to show yet</p>
      <p className="max-w-xs text-[13px] leading-snug text-text-muted">Run the check and the page appears here, on the device you pick.</p>
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
  /** The run control, at the right of the header's first line. */
  headerAction?: ReactNode;
  /** The picker line: the width squares, or the device dropdown and glance strip. */
  picker: ReactNode;
  frame: ReactNode;
  /** The bar under the device: live, open, compare. */
  action?: ReactNode;
  rail: ReactNode;
  railLabel?: string;
}) {
  const slots = useTabSlots();
  return (
    <div className="@container flex flex-col gap-4">
      <Rise order={0}>
        <div className="rounded-2xl border border-border-soft bg-card shadow-xs">
          <div className="flex flex-wrap items-center gap-3 px-4 py-3">
            {slots?.tabs}
            {(headerAction || slots?.right) && (
              <div className="ml-auto flex flex-wrap items-center gap-2">
                {headerAction}
                {slots?.right}
              </div>
            )}
          </div>
          <div className="px-4 pb-4">
            <VerdictLine verdict={verdict} />
            {slots?.explain && <p className="mt-2 text-[13px] text-text-secondary">{slots.explain}</p>}
          </div>
          {picker && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-3 border-t border-border-soft px-4 py-3">
              {picker}
            </div>
          )}
        </div>
      </Rise>

      <div {...(slots?.panelProps ?? {})} className="flex flex-col gap-4">
        <Rise order={1}>
          <section
            id={STAGE_ID}
            aria-label="Screenshot"
            className="flex scroll-mt-4 flex-col items-center gap-4 rounded-2xl border border-border-soft bg-card-soft p-4"
          >
            <div className="flex w-full flex-1 flex-col items-center justify-center gap-3">{frame ?? <EmptyStage />}</div>
            {action}
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
