"use client";

import { useEffect, useRef, useState } from "react";
import { animate, useReducedMotion } from "motion/react";

/**
 * A column's card count, ticking from where it was to where it is.
 *
 * The shared AnimatedNumber counts from zero every time its value changes,
 * which is right for a stat that appears once and wrong for a number that
 * goes 3 → 4: it would run 0 → 4 on every move.
 */
export function CountUp({ value, duration = 0.3 }: { value: number; duration?: number }) {
  const reduce = useReducedMotion();
  const previous = useRef(value);
  const [display, setDisplay] = useState(value);

  useEffect(() => {
    const from = previous.current;
    previous.current = value;
    if (reduce || from === value) { setDisplay(value); return; }
    const controls = animate(from, value, {
      duration,
      ease: "easeOut",
      onUpdate: (v) => setDisplay(Math.round(v)),
    });
    return () => controls.stop();
  }, [value, duration, reduce]);

  return <>{reduce ? value : display}</>;
}
