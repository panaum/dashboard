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
// The stage is a near-white surface, not a dark panel, and it carries no
// gradient and no shadow. The device bezel is already near-black, so it reads
// harder against light than it ever did against navy, and the page stays one
// product rather than two.
//
// SPACING. An 8px scale: 8, 16, 24, 32 and nothing between them for padding,
// margins and gaps. The handset drawing's own bezels are geometry, not
// spacing, and keep the proportions of the device they depict.
//
// TYPE SCALE. Five steps, and nothing between them:
//   30  the site name (the page's h1, above this component)
//   24  the verdict — the two-second read, on a line of its own
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

/** The two-second read: what this run says, in one sentence on a line of its
 *  own. How the run splits by device, and how the last few runs went, sit on
 *  the line under it — nothing shares the verdict's line. */
export function VerdictLine({ verdict, chips, trend }: { verdict: TabVerdict; chips?: ReactNode; trend?: TrendPoint[] }) {
  const Icon = ICON[verdict.tone];
  const hasTrend = Boolean(trend && trend.length > 1);
  return (
    <div className="flex flex-col gap-2">
      <p className={cn("flex items-start gap-2 text-[24px] font-semibold leading-8 tracking-tight", TONE[verdict.tone])}>
        {/* A 32px box the height of one line, so the mark centres on the
            first line without a nudge that would sit off the spacing scale. */}
        <span className="flex h-8 shrink-0 items-center"><Icon className="size-6" strokeWidth={2} aria-hidden /></span>
        <span className="min-w-0 text-balance">{verdict.headline}</span>
      </p>
      {(verdict.compare || chips || hasTrend) && (
        <div className="flex flex-col gap-4 @3xl:flex-row @3xl:items-start @3xl:justify-between">
          {/* Indented to the verdict's text, past the 24px mark and its 8px gap. */}
          <div className="flex min-w-0 flex-col gap-2 pl-8">
            {verdict.compare && <p className="text-[13px] leading-5 text-text-secondary">{verdict.compare}</p>}
            {/* Counts in words, not pills: the tone is on the number. */}
            {chips && <p className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[13px] leading-5 text-text-secondary">{chips}</p>}
          </div>
          {hasTrend && <Trend points={trend!} />}
        </div>
      )}
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
    <div className="flex shrink-0 flex-col gap-2 @3xl:w-[240px]" aria-label={`Errors over the last ${values.length} runs: ${values.join(", ")}`}>
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

/** A button on the stage bar. Neutral until hovered; the accent means
 *  "pressed" and nothing else, as it does everywhere on this page. */
export function StageButton({
  on = false, children, className, ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { on?: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={rest["aria-pressed"] ?? (on || undefined)}
      {...rest}
      className={cn(
        "inline-flex h-9 items-center gap-2 rounded-lg border px-4 text-[13px] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-text-primary disabled:opacity-50",
        on
          ? "border-accent bg-accent text-white"
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
    <p className="max-w-md text-center text-[13px] leading-5 text-text-secondary">
      <span className="text-[15px] font-semibold text-text-primary">{title}</span>
      {children}
    </p>
  );
}

/** Classes for a DeviceFrame on the stage. Nothing: a near-black bezel on a
 *  near-white surface has its edge already, and needs no rim and no shadow. */
export const ON_STAGE = "";

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
// it is sized to the WINDOW, not to whatever is left under the header: the
// header takes ~390px, and fitting the stage into the remainder pinned the
// frame at its floor. Sized to the window, the stage fills the screen once it
// is scrolled into view, which choosing a finding does. The reserve is what
// the stage spends around the frame: its padding, the caption lines, the
// gaps and the button bar.
const STAGE_RESERVE = 176;
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
      setRoom(Math.max(STAGE_MIN, Math.round(window.innerHeight - STAGE_RESERVE)));
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
    <div className="flex flex-col items-center gap-2 text-center">
      <MonitorSmartphone className="size-8 text-text-secondary" aria-hidden />
      <p className="text-[15px] font-semibold text-text-primary">Nothing to show yet</p>
      <p className="max-w-xs text-[13px] leading-5 text-text-secondary">Run the check and the page appears here, on the device you pick.</p>
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
  /** Between the controls and the stage: the device health matrix, which the
      panel keeps folded until it is asked for. */
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

      {/* Whatever the panel wants between the controls and the stage — the
          device health matrix, folded away until asked for. It brings its own
          surface, because most of the time it is a single button. */}
      {matrix && <Rise order={1}>{matrix}</Rise>}

      {/* Stage and findings side by side, as they are on both tabs, so the
          interaction is learned once. items-start: neither column stretches to
          the other's height, which is what left the stage half empty. */}
      <StageHeightContext.Provider value={room}>
        <div {...(slots?.panelProps ?? {})}
             className="grid items-start gap-6 @4xl:grid-cols-[minmax(0,1fr)_344px]">
          <Rise order={1} className="min-w-0">
            <section
              ref={stage}
              id={STAGE_ID}
              aria-label="Screenshot"
              className="relative flex scroll-mt-4 flex-col items-center gap-4 overflow-hidden rounded-2xl bg-card p-4"
            >
              {/* The device is the point of this page, so it gets the room. The
                  surface is plain: no gradient, no shadow, no border — the
                  near-black bezel is the edge. */}
              <div className="relative flex w-full flex-col items-center gap-2">{frame ?? <EmptyStage />}</div>
              {action && <div className="relative">{action}</div>}
            </section>
          </Rise>

          <Rise order={2} className="min-w-0">
            {/* No card. The heading and the space under it group the list; a
                box would only add a line around something already grouped.
                The top padding lines the heading up with the stage's contents. */}
            <section
              aria-label={railLabel ?? "Findings"}
              className="pt-4"
            >
              {rail}
            </section>
          </Rise>
        </div>
      </StageHeightContext.Provider>
    </div>
  );
}
