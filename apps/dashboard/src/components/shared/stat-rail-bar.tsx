"use client";

import { motion } from "motion/react";

/** Thin 3px progress bar under a stat-rail number. Empty track = gray. */
export function StatRailBar({ pct, color }: { pct: number; color: string }) {
  const width = Math.max(0, Math.min(100, pct));
  return (
    <div className="mt-3 h-[3px] w-full overflow-hidden rounded-full bg-border-soft">
      <motion.div
        className={`h-full rounded-full ${color}`}
        initial={{ width: 0 }}
        animate={{ width: `${width}%` }}
        transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
      />
    </div>
  );
}
