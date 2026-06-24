"use client";

import { useId } from "react";
import { motion } from "motion/react";
import { AnimatedNumber } from "@/components/shared/animated-number";
import type { QualityScore } from "@/lib/quality-score";

// Tone → gradient stops. Brighter, jewel-toned arcs read as premium against
// both the dark hero and the light deliverable cards.
const GRADIENT: Record<string, [string, string]> = {
  success: ["#2fb874", "#7af0ad"],
  warning: ["#f5a623", "#ffd27a"],
  error: ["#e05c5c", "#ff9a9a"],
  neutral: ["#9a9ab0", "#c8c8d8"],
  info: ["#5b8def", "#9bc1ff"],
  brand: ["#6366f1", "#b8b0f0"],
};

/**
 * Quality-score gauge: gradient arc that draws in on mount with a soft glow,
 * and a number that counts up. `variant="dark"` flips the text/track for the
 * dark hero. Used across the client portal.
 */
export function ScoreRing({
  score,
  size = 96,
  stroke = 8,
  variant = "light",
  glow = true,
}: {
  score: QualityScore;
  size?: number;
  stroke?: number;
  variant?: "light" | "dark";
  glow?: boolean;
}) {
  const uid = useId().replace(/[:]/g, "");
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = score.provisional ? 0 : score.score / 100;
  const [from, to] = GRADIENT[score.tone] ?? GRADIENT.neutral;
  const dark = variant === "dark";

  return (
    <div
      className="relative inline-flex shrink-0 items-center justify-center"
      style={{ width: size, height: size }}
    >
      <svg
        width={size}
        height={size}
        className="-rotate-90"
        style={glow && !score.provisional ? { filter: `drop-shadow(0 0 ${size * 0.05}px ${to}77)` } : undefined}
      >
        <defs>
          <linearGradient id={`ring-${uid}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor={from} />
            <stop offset="100%" stopColor={to} />
          </linearGradient>
        </defs>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={stroke}
          stroke={dark ? "rgba(255,255,255,0.14)" : "var(--color-border-soft)"}
        />
        {!score.provisional && (
          <motion.circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={`url(#ring-${uid})`}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={c}
            initial={{ strokeDashoffset: c }}
            animate={{ strokeDashoffset: c * (1 - pct) }}
            transition={{ duration: 1.1, ease: [0.22, 1, 0.36, 1] }}
          />
        )}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        {score.provisional ? (
          <span
            className={dark ? "text-text-on-dark/70" : "text-text-muted"}
            style={{ fontSize: Math.max(10, size * 0.13) }}
          >
            In review
          </span>
        ) : (
          <>
            <span
              className={`font-semibold tabular-nums ${dark ? "text-text-on-dark" : "text-text-primary"}`}
              style={{ fontSize: size * 0.3, lineHeight: 1 }}
            >
              <AnimatedNumber value={score.score} />
            </span>
            {size >= 44 && (
              <span
                className={`font-medium uppercase tracking-[0.1em] ${dark ? "text-text-on-dark/55" : "text-text-muted"}`}
                style={{ fontSize: Math.max(8, size * 0.1) }}
              >
                Score
              </span>
            )}
          </>
        )}
      </div>
    </div>
  );
}
