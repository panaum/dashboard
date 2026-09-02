"use client";

import { AnimatedNumber } from "@/components/shared/animated-number";
import { StatRailBar } from "@/components/shared/stat-rail-bar";
import type { MonitorSummary } from "@/lib/linkspy/monitor-metrics";

// Portfolio rail for the Sites page — same connected-rail pattern as the
// Overview, so the two pages read as one product. Health colors are separate
// from the accent (which stays interactive-only).

export function SitesStatRail({ summary }: { summary: MonitorSummary }) {
  const { monitored, healthy, attention, neverScanned, fixed, avgHealth } = summary;
  const pct = (n: number) => (monitored ? (n / monitored) * 100 : 0);

  const stats: Array<{
    label: string; value: number; descriptor: string;
    color: string; pct: number; emphasis?: string;
  }> = [
    { label: "Monitored", value: monitored, descriptor: "Properties", color: "bg-info", pct: 100 },
    { label: "Healthy", value: healthy, descriptor: "No issues found",
      color: "bg-success", pct: pct(healthy), emphasis: "text-success" },
    { label: "Needs attention", value: attention, descriptor: "Broken or dead CTAs",
      color: "bg-error", pct: pct(attention), emphasis: "text-error" },
    { label: "Not scanned", value: neverScanned, descriptor: "No baseline yet", color: "bg-text-muted", pct: pct(neverScanned) },
    {
      label: "Avg health",
      value: avgHealth ?? 0,
      descriptor: avgHealth === null ? "No scans yet" : "Across scanned sites",
      color: "bg-brand-blue",
      pct: avgHealth ?? 0,
    },
    { label: "Fixed", value: fixed, descriptor: "This month",
      color: "bg-brand-purple", pct: fixed ? 100 : 0, emphasis: "text-success" },
  ];

  return (
    <div className="mb-6 grid grid-cols-2 divide-border-soft overflow-hidden rounded-xl border border-border-soft bg-card sm:grid-cols-3 sm:divide-x lg:grid-cols-6">
      {stats.map((s) => (
        <div key={s.label} className="px-5 py-4">
          <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-text-muted">
            {s.label}
          </div>
          <div className={`mt-2 text-[30px] font-semibold leading-none tracking-tight tabular-nums ${
            s.emphasis && s.value > 0 ? s.emphasis : "text-text-primary"
          }`}>
            {s.label === "Avg health" && avgHealth === null ? (
              <span className="text-text-muted">—</span>
            ) : (
              <AnimatedNumber value={s.value} />
            )}
          </div>
          <StatRailBar pct={s.pct} color={s.color} />
          <div className="mt-2.5 text-[12px] text-text-muted">{s.descriptor}</div>
        </div>
      ))}
    </div>
  );
}
