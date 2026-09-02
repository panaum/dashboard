"use client";

import { useEffect, useState } from "react";
import { animate, useReducedMotion } from "motion/react";

/** Counts up to `value` on mount. Supports decimals for averages. */
export function AnimatedNumber({
  value,
  decimals = 0,
  duration = 0.8,
}: {
  value: number;
  decimals?: number;
  duration?: number;
}) {
  const reduce = useReducedMotion();
  const [display, setDisplay] = useState(0);

  useEffect(() => {
    // A count-up is motion, and the global CSS reduced-motion rule only
    // reaches CSS transitions — a JS-driven counter has to opt out itself.
    if (reduce) return;
    const controls = animate(0, value, {
      duration,
      ease: "easeOut",
      onUpdate: (v) => setDisplay(v),
    });
    return () => controls.stop();
  }, [value, duration, reduce]);

  // Derived, not stored: under reduced motion the final value is simply what
  // renders, with no animation frame and no state write.
  const shown = reduce ? value : display;

  return <>{shown.toFixed(decimals)}</>;
}
