"use client";

import { useEffect, useState } from "react";
import { animate } from "motion/react";
import { cn } from "@/lib/utils";

export function StatCard({
  value,
  unit,
  danger,
  index = 0,
}: {
  value: number;
  unit: string;
  /** Subtle attention treatment, e.g. open issues when > 0. */
  danger?: boolean;
  /** Position in the row, for staggered entrance. */
  index?: number;
}) {
  const [display, setDisplay] = useState(0);
  const active = danger && value > 0;

  useEffect(() => {
    const controls = animate(0, value, {
      duration: 0.8,
      ease: "easeOut",
      onUpdate: (v) => setDisplay(Math.round(v)),
    });
    return () => controls.stop();
  }, [value]);

  return (
    <div className="animate-in rounded-xl border border-border-soft bg-card px-5 py-4 transition-[colors,transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:border-accent/40 hover:shadow-sm"
      style={{ animationDelay: `${index * 50}ms` }}
    >
      <div
        className={cn(
          "flex items-baseline gap-1.5 text-[32px] font-semibold leading-none tracking-tight tabular-nums",
          active ? "text-error" : "text-text-primary",
        )}
      >
        {active && <span className="size-2 self-center rounded-full bg-error" />}
        {display}
      </div>
      <div className="mt-2.5 text-[12px] font-medium text-text-secondary">
        {unit}
      </div>
    </div>
  );
}
