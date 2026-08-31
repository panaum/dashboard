"use client";

import { motion } from "motion/react";
import { cn } from "@/lib/utils";

type Counts = { passed: number; failed: number; na: number; total: number };

function health({ passed, failed, na, total }: Counts) {
  const graded = passed + failed + na;
  const pct = total ? graded / total : 0;
  // Amber if anything failed; green when fully graded & clean; indigo while in progress.
  const stroke =
    failed > 0
      ? "stroke-warning"
      : pct >= 1 && total > 0
        ? "stroke-success"
        : "stroke-accent";
  return { graded, pct, stroke };
}

/** Circular QA completion gauge — arc draws in on mount, colour = health. */
export function QARing({
  passed,
  failed,
  na,
  total,
  size = 48,
  stroke = 5,
  showLabel = true,
  className,
}: Counts & {
  size?: number;
  stroke?: number;
  showLabel?: boolean;
  className?: string;
}) {
  const { pct, stroke: strokeClass } = health({ passed, failed, na, total });
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;

  return (
    <div
      className={cn("relative shrink-0", className)}
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={stroke}
          className="stroke-card-soft"
        />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circ}
          initial={{ strokeDashoffset: circ }}
          animate={{ strokeDashoffset: circ * (1 - pct) }}
          transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
          className={strokeClass}
        />
      </svg>
      {showLabel && (
        <span
          className="absolute inset-0 flex items-center justify-center font-semibold tabular-nums text-text-primary"
          style={{ fontSize: size * 0.28 }}
        >
          {Math.round(pct * 100)}
          <span className="text-text-muted" style={{ fontSize: size * 0.2 }}>
            %
          </span>
        </span>
      )}
    </div>
  );
}
