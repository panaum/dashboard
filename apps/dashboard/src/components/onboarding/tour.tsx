"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useReducedMotion, type Variants } from "motion/react";
import { ArrowLeft, ArrowRight, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Actor, Rank } from "@/lib/permissions";
import { tourFor, type TourStep } from "@/lib/onboarding";
import { completeOnboarding } from "@/app/dashboard/personalization/actions";

/** Anything can start the tour — onboarding's last step, "Retake the tour" on
 *  the profile page — by dispatching this event; one host listens for it. */
export const TOUR_EVENT = "tour:start";
/** `rank` tours as that rank (an admin demoing a Viewer's tour); `demo`
 *  means nobody's onboarding is being finished, so nothing is written. */
export type TourStart = { rank?: Rank; demo?: boolean };
export const startTour = (opts: TourStart = {}) =>
  window.dispatchEvent(new CustomEvent<TourStart>(TOUR_EVENT, { detail: opts }));

// A different entrance per step, so the tour reads as considered rather than
// one template stamped six times. Cycled by index.
const ENTRANCES: Variants[] = [
  { hidden: { opacity: 0, scale: 0.92 }, shown: { opacity: 1, scale: 1 } },
  { hidden: { opacity: 0, x: -24 }, shown: { opacity: 1, x: 0 } },
  { hidden: { opacity: 0, y: 18 }, shown: { opacity: 1, y: 0 } },
  { hidden: { opacity: 0, filter: "blur(6px)" }, shown: { opacity: 1, filter: "blur(0px)" } },
  { hidden: { opacity: 0, rotate: -2, scale: 0.96 }, shown: { opacity: 1, rotate: 0, scale: 1 } },
  { hidden: { opacity: 0, x: 24 }, shown: { opacity: 1, x: 0 } },
];
const FADE: Variants = { hidden: { opacity: 0 }, shown: { opacity: 1 } };

const PAD = 6;       // spotlight breathing room around the target
const CARD_W = 320;
const GAP = 16;

type Rect = { top: number; left: number; width: number; height: number };

function rectOf(step: TourStep | undefined): Rect | null {
  if (!step) return null;
  const el = document.querySelector<HTMLElement>(`[data-tour="${step.target}"]`);
  if (!el) return null;
  let r = el.getBoundingClientRect();
  // On a long page the sidebar grows with it and Personalization can sit below the
  // fold; bring the target on screen before lighting it.
  if (r.top < 0 || r.bottom > window.innerHeight) {
    el.scrollIntoView({ block: "nearest" });
    r = el.getBoundingClientRect();
  }
  return { top: r.top - PAD, left: r.left - PAD, width: r.width + PAD * 2, height: r.height + PAD * 2 };
}

/**
 * The tour. Mounted once in the dashboard layout; idle until TOUR_EVENT.
 * Steps are tourFor(actor) at the moment it starts — the sidebar's own
 * visibleNav rule applied to the tour list — so nobody is shown a page they
 * cannot open. Finishing or skipping writes the onboarding flag server-side.
 */
export function TourHost({ actor, onEnd }: { actor: Actor; onEnd?: () => void }) {
  const [steps, setSteps] = useState<TourStep[] | null>(null);
  const [i, setI] = useState(0);
  const [demo, setDemo] = useState(false);
  const [rect, setRect] = useState<Rect | null>(null);
  const [vw, setVw] = useState(0);
  const [vh, setVh] = useState(0);
  const cardRef = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();

  useEffect(() => {
    const start = (e: Event) => {
      const opts = (e as CustomEvent<TourStart>).detail ?? {};
      setSteps(tourFor(opts.rank ? { ...actor, rank: opts.rank } : actor));
      setDemo(Boolean(opts.demo));
      setI(0);
    };
    window.addEventListener(TOUR_EVENT, start);
    return () => window.removeEventListener(TOUR_EVENT, start);
  }, [actor]);

  const step = steps?.[i];

  // Follow the target: on each step, and whenever the window moves under it.
  useLayoutEffect(() => {
    if (!step) return;
    const measure = () => { setRect(rectOf(step)); setVw(window.innerWidth); setVh(window.innerHeight); };
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => { window.removeEventListener("resize", measure); window.removeEventListener("scroll", measure, true); };
  }, [step]);

  useEffect(() => { if (step) cardRef.current?.focus(); }, [step]);

  const end = useCallback(() => {
    setSteps(null);
    setRect(null);
    // Written once, server-side; harmless on a retake. A demo finishes
    // nobody's onboarding, so it writes nothing.
    if (!demo) void completeOnboarding();
    onEnd?.();
  }, [onEnd, demo]);

  const next = useCallback(() => {
    if (!steps) return;
    if (i >= steps.length - 1) end(); else setI(i + 1);
  }, [steps, i, end]);
  const back = useCallback(() => setI((n) => Math.max(0, n - 1)), []);

  useEffect(() => {
    if (!step) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") end();
      else if (e.key === "ArrowRight") next();
      else if (e.key === "ArrowLeft") back();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [step, next, back, end]);

  if (!steps || !step) return null;

  // Beside the target when there is room (the sidebar is on the left, so
  // there usually is); otherwise above or below it, full width, at phone
  // sizes. A target in the lower half anchors the card by its bottom edge so
  // it grows upward — Personalization sits at the foot of the sidebar, and a card
  // hung from its middle ran off the screen with Finish out of reach.
  const low = rect ? rect.top + rect.height / 2 > vh / 2 : false;
  const beside = rect && vw - (rect.left + rect.width) >= CARD_W + GAP * 2;
  const cardStyle: React.CSSProperties = !rect
    ? { left: "50%", top: "40%", width: CARD_W, transform: "translateX(-50%)" }
    : beside
      ? low
        ? { left: rect.left + rect.width + GAP, bottom: Math.max(GAP, vh - (rect.top + rect.height)), width: CARD_W }
        : { left: rect.left + rect.width + GAP, top: Math.max(GAP, rect.top), width: CARD_W }
      : low
        ? { left: GAP, right: GAP, bottom: vh - rect.top + GAP }
        : { left: GAP, right: GAP, top: rect.top + rect.height + GAP };
  const entrance = reduce ? FADE : ENTRANCES[i % ENTRANCES.length];

  return createPortal(
    <div className="fixed inset-0 z-[60]" aria-live="polite">
      {/* The dim with a hole in it: one element whose enormous shadow is the
          scrim, so the target stays lit and clickable-looking, and the hole
          glides from item to item rather than jumping. */}
      {rect ? (
        <motion.div
          className="pointer-events-none fixed rounded-xl ring-2 ring-accent/70"
          style={{ boxShadow: "0 0 0 9999px rgba(20, 20, 43, 0.55), 0 0 24px 4px rgba(79, 70, 229, 0.45)" }}
          initial={false}
          animate={{ top: rect.top, left: rect.left, width: rect.width, height: rect.height }}
          transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 260, damping: 30 }}
        />
      ) : (
        <div className="fixed inset-0 bg-[rgba(20,20,43,0.55)]" />
      )}

      <AnimatePresence mode="wait">
        <motion.div
          key={step.id}
          ref={cardRef}
          tabIndex={-1}
          role="dialog"
          aria-modal="true"
          aria-labelledby="tour-title"
          className="fixed rounded-xl border border-border-soft bg-card p-5 shadow-lg outline-none"
          style={cardStyle}
          variants={entrance}
          initial="hidden"
          animate="shown"
          exit="hidden"
          transition={reduce ? { duration: 0.12 } : { type: "spring", stiffness: 380, damping: 30 }}
        >
          <div className="mb-2 flex items-center justify-between gap-3">
            <span className="text-[11px] font-semibold uppercase tracking-[0.07em] text-text-muted">
              {i + 1} of {steps.length}
            </span>
            <button type="button" onClick={end} className="flex items-center gap-1 rounded-md px-1.5 py-1 text-xs font-medium text-text-secondary hover:bg-card-soft hover:text-text-primary">
              Skip tour <X className="size-3.5" />
            </button>
          </div>
          <h2 id="tour-title" className="text-base font-semibold text-text-primary">{step.title}</h2>
          <p className="mt-1.5 text-sm leading-relaxed text-text-secondary">{step.body}</p>

          {/* Progress: one dot per step, the current one stretched. */}
          <div className="mt-4 flex items-center justify-between gap-3">
            <div className="flex items-center gap-1.5" aria-hidden>
              {steps.map((s, n) => (
                <motion.span
                  key={s.id}
                  className={n === i ? "h-1.5 rounded-full bg-accent" : "h-1.5 rounded-full bg-border-soft"}
                  animate={{ width: n === i ? 18 : 6 }}
                  transition={{ duration: reduce ? 0 : 0.25 }}
                />
              ))}
            </div>
            <div className="flex items-center gap-2">
              {i > 0 && (
                <Button type="button" variant="ghost" size="sm" onClick={back}>
                  <ArrowLeft /> Back
                </Button>
              )}
              <Button type="button" size="sm" onClick={next}>
                {i === steps.length - 1 ? "Finish" : <>Next <ArrowRight /></>}
              </Button>
            </div>
          </div>
        </motion.div>
      </AnimatePresence>
    </div>,
    document.body,
  );
}
