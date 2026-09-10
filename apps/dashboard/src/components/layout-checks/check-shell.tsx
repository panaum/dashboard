"use client";

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { motion, useReducedMotion } from "motion/react";
import { CheckCircle2, AlertTriangle, XCircle, MinusCircle, MonitorSmartphone } from "lucide-react";
import { cn } from "@/lib/utils";
import { ms } from "@/lib/layout-checks/motion";
import type { TabVerdict } from "@/lib/layout-checks/verdict";
import { spark, trendValues, type TrendPoint } from "@/lib/layout-checks/sparkline";
import { useTabSlots } from "@/components/layout-checks/site-tabs";

// The one layout both tabs share, in three bands. A header: the tab control
// and the run controls on one line, the verdict on its own line under them,
// the picker under that. Then the device on its own surface, with the
// findings for that ONE screenshot beside it.
//
// The stage is a light surface, a step off the page — not a dark panel. The
// device bezel is already near-black, so it reads harder against light than
// it ever did against navy, and the page stays one product rather than two.
//
// TYPE SCALE. Five steps, and nothing between them:
//   30  the site name (the page's h1, above this component)
//   21  the verdict — the two-second read
//   15  a section's subject: which device, which width
//   13  body: a finding, a caption, a control
//   11  labels and metadata, uppercase where it names a control
// Hierarchy is carried by size and weight. The header has no card around it:
// a box adds a line without adding a grouping that the spacing does not
// already make.

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

/** The two-second read: what this run says, in one sentence — with how the
 *  run splits by device under it, and how the last few runs went beside it. */
export function VerdictLine({ verdict, chips, trend }: { verdict: TabVerdict; chips?: ReactNode; trend?: TrendPoint[] }) {
  const Icon = ICON[verdict.tone];
  return (
    <div className="flex flex-col gap-4 @3xl:flex-row @3xl:items-start @3xl:justify-between">
      <div className="flex items-start gap-2">
        <Icon className={cn("mt-1 size-6 shrink-0", TONE[verdict.tone])} strokeWidth={2} aria-hidden />
        <div className="flex min-w-0 flex-col gap-1">
          <p className={cn("text-[21px] font-semibold leading-tight tracking-tight text-balance", TONE[verdict.tone])}>
            {verdict.headline}
          </p>
          {verdict.compare && <p className="text-[13px] leading-snug text-text-secondary">{verdict.compare}</p>}
          {chips && <div className="mt-1 flex flex-wrap items-center gap-2">{chips}</div>}
        </div>
      </div>
      {trend && trend.length > 1 && <Trend points={trend} />}
    </div>
  );
}

/** Errors per run, the last eight, oldest to newest. Today's point is solid. */
function Trend({ points }: { points: TrendPoint[] }) {
  const values = trendValues(points, 8);
  const W = 240, H = 56;
  const s = spark(values, W, H, 8);
  const last = s.dots[s.dots.length - 1];
  const first = s.dots[0];
  // A run with nothing wrong is not a red line. The colour follows the latest
  // run: red while there are errors, green once there are none.
  const tone = last && last.value === 0 ? "success" : "error";
  const stroke = tone === "success" ? "stroke-success" : "stroke-error";
  const fill = tone === "success" ? "fill-success" : "fill-error";
  // Value labels sit above their dot, never on it, and never off the top.
  const above = (y: number) => Math.max(10, y - 9);
  const oldest = points.slice(0, 8).at(-1)?.checkedAt;
  const when = oldest ? new Date(oldest).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "";
  return (
    <div className="flex shrink-0 flex-col gap-1 @3xl:w-[240px]" aria-label={`Errors over the last ${values.length} runs: ${values.join(", ")}`}>
      <div className="flex items-baseline justify-between text-[11px]">
        <span className="font-semibold uppercase tracking-[0.08em] text-text-secondary">Last {values.length} runs</span>
        <span className="text-text-secondary">errors per run</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-14 w-full overflow-visible" aria-hidden>
        <line x1="0" y1={H - 1} x2={W} y2={H - 1} className="stroke-border-soft" strokeWidth="1" />
        <polyline points={s.points} fill="none" className={stroke} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        {s.dots.map((d, i) => (
          <circle key={i} cx={d.x} cy={d.y} r={i === s.dots.length - 1 ? 4.5 : 3} className={cn(i === s.dots.length - 1 ? `${fill} stroke-card` : `fill-card ${stroke}`)} strokeWidth="2" />
        ))}
        {first && first !== last && <text x={first.x} y={above(first.y)} textAnchor="start" className="fill-text-secondary text-[11px]">{first.value}</text>}
        {last && <text x={last.x} y={above(last.y)} textAnchor="end" className="fill-text-primary text-[11px] font-semibold">{last.value}</text>}
      </svg>
      <div className="flex justify-between text-[11px] text-text-secondary"><span>{when}</span><span>latest</span></div>
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
      <span className="text-[15px] font-semibold text-text-primary">{title}</span>
      {children}
    </p>
  );
}

/** Classes for a DeviceFrame on the stage: a hairline, so the dark bezel has an edge. */
export const ON_STAGE = "ring-1 ring-border-soft";

/** A small uppercase label beside a control. */
export function BarLabel({ children }: { children: ReactNode }) {
  return <span className="shrink-0 text-[11px] font-semibold uppercase tracking-[0.08em] text-text-secondary">{children}</span>;
}

/** A section's subject line: what this screenshot or list is about. */
export function SectionHeading({ label, subject, children }: { label: string; subject?: ReactNode; children?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2">
      <BarLabel>{label}</BarLabel>
      {subject && <p className="truncate text-[15px] font-semibold text-text-primary">{subject}</p>}
      {children}
    </div>
  );
}

export const STAGE_ID = "check-stage";

// How tall the frame may be. The screenshot is the thing being examined, so
// it gets the height the window actually has rather than a number chosen in
// advance — measured from where the stage starts to the bottom of the window,
// less what the stage spends on its own padding, caption and buttons.
const STAGE_RESERVE = 140;
const STAGE_MIN = 380;

const StageHeightContext = createContext<number | null>(null);

/** The height a frame may fill, or null before the stage has been measured. */
export function useStageHeight(): number | null {
  return useContext(StageHeightContext);
}

function useRoomBelow(ref: React.RefObject<HTMLElement | null>): number | null {
  const [room, setRoom] = useState<number | null>(null);
  useEffect(() => {
    const measure = () => {
      const el = ref.current;
      if (!el) return;
      // Document-relative, so the answer is "how tall can this be when the
      // page is at the top", not "how much is left from where you scrolled".
      const top = el.getBoundingClientRect().top + window.scrollY;
      setRoom(Math.max(STAGE_MIN, Math.round(window.innerHeight - top - STAGE_RESERVE)));
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [ref]);
  return room;
}

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
      <MonitorSmartphone className="size-8 text-text-secondary" aria-hidden />
      <p className="text-[15px] font-semibold text-text-primary">Nothing to show yet</p>
      <p className="max-w-xs text-[13px] leading-snug text-text-secondary">Run the check and the page appears here, on the device you pick.</p>
    </div>
  );
}

export function CheckShell({
  verdict,
  chips,
  trend,
  headerAction,
  picker,
  matrix,
  frame,
  action,
  rail,
  railLabel,
}: {
  verdict: TabVerdict;
  /** How the run splits by device, under the verdict. */
  chips?: ReactNode;
  /** Errors per run, newest first, for the trend beside the verdict. */
  trend?: TrendPoint[];
  /** A full-width band between the header and the stage: the device health matrix. */
  matrix?: ReactNode;
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
  const stage = useRef<HTMLElement>(null);
  const room = useRoomBelow(stage);
  return (
    <div className="@container flex flex-col gap-4">
      <Rise order={0}>
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2">
            {slots?.tabs}
            {(headerAction || slots?.right) && (
              <div className="ml-auto flex flex-wrap items-center gap-2">
                {headerAction}
                {slots?.right}
              </div>
            )}
          </div>
          <div>
            <VerdictLine verdict={verdict} chips={chips} trend={trend} />
            {slots?.explain && <p className="mt-2 text-[13px] text-text-secondary">{slots.explain}</p>}
          </div>
          {picker && <div className="flex flex-wrap items-center gap-x-4 gap-y-2">{picker}</div>}
        </div>
      </Rise>

      {matrix && (
        <Rise order={1}>
          <section aria-label="Device health" className="rounded-2xl border border-border-soft bg-card px-4 py-4 shadow-xs @3xl:px-6">
            {matrix}
          </section>
        </Rise>
      )}

      {/* Stage and findings side by side, as they are on both tabs, so the
          interaction is learned once. items-start: neither column stretches to
          the other's height, which is what left the stage half empty. */}
      <StageHeightContext.Provider value={room}>
        <div {...(slots?.panelProps ?? {})}
             className="grid items-start gap-4 @4xl:grid-cols-[minmax(0,1fr)_340px]">
          <Rise order={1} className="min-w-0">
            <section
              ref={stage}
              id={STAGE_ID}
              aria-label="Screenshot"
              className="flex scroll-mt-4 flex-col items-center gap-4 rounded-2xl border border-border-soft bg-card-soft p-4"
            >
              <div className="flex w-full flex-col items-center gap-3">{frame ?? <EmptyStage />}</div>
              {action}
            </section>
          </Rise>

          <Rise order={2} className="min-w-0">
            <section
              aria-label={railLabel ?? "Findings"}
              className="rounded-2xl border border-border-soft bg-card p-4 shadow-xs"
            >
              {rail}
            </section>
          </Rise>
        </div>
      </StageHeightContext.Provider>
    </div>
  );
}
