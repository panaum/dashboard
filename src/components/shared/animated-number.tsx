"use client";

import { useEffect, useState } from "react";
import { animate } from "motion/react";

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
  const [display, setDisplay] = useState(0);

  useEffect(() => {
    const controls = animate(0, value, {
      duration,
      ease: "easeOut",
      onUpdate: (v) => setDisplay(v),
    });
    return () => controls.stop();
  }, [value, duration]);

  return <>{display.toFixed(decimals)}</>;
}
