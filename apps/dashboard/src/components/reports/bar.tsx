"use client";

import { motion } from "motion/react";

/** A single animated horizontal bar (0–100%). */
export function Bar({
  pct,
  colorClass,
  delay = 0,
}: {
  pct: number;
  colorClass: string;
  delay?: number;
}) {
  return (
    <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-card-soft">
      <motion.div
        className={`relative h-full overflow-hidden rounded-full ${colorClass}`}
        initial={{ width: 0 }}
        animate={{ width: `${pct}%` }}
        transition={{ type: "spring", stiffness: 120, damping: 22, delay }}
      >
        <motion.span
          className="absolute inset-y-0 left-0 w-1/3 bg-gradient-to-r from-transparent via-white/35 to-transparent"
          initial={{ x: "-150%" }}
          animate={{ x: "400%" }}
          transition={{ duration: 1, delay: delay + 0.35, ease: "easeInOut" }}
        />
      </motion.div>
    </div>
  );
}
