"use client";

import { useEffect, useState, type KeyboardEvent } from "react";
import { cn } from "@/lib/utils";
import { rovingTarget } from "@/lib/layout-checks/roving";
import { CHECKS, cellsFor, cellWords, type Cell, type Finding } from "@/lib/layout-checks/matrix";
import { groupDevices, type DeviceView } from "@/lib/layout-checks/devices-view";
import type { DeviceRunState } from "@/lib/layout-checks/run-progress";
import { serviceLine, type ServiceHealth } from "@/lib/layout-checks/service-line";

// Every device against every check. Rows are the picker — one radio group,
// one tab stop, arrows walk the rows — so choosing a device and reading its
// health are the same gesture. Below a wide container the check columns fold
// away and the rows keep their verdict chip, which is the old strip's
// information in the old strip's space.

const CELL: Record<Cell["tone"], string> = {
  error: "bg-error/12 text-error-strong ring-1 ring-inset ring-error/35",
  warning: "bg-warning/15 text-warning-strong ring-1 ring-inset ring-warning/40",
  clean: "bg-success/10 text-success-strong",
  na: "text-text-secondary",
};

const RUN: Record<DeviceRunState, string> = { waiting: "Waiting", captured: "Captured", failed: "Capture failed" };

function Tick() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="size-3.5" aria-hidden>
      <path d="M5 12.5l4.5 4.5L19 7" />
    </svg>
  );
}

function Verdict({ d, run }: { d: DeviceView; run: DeviceRunState | null }) {
  // Words in the row's last column, coloured by severity — a pill in every
  // row of a table is a box repeated fourteen times.
  const word = "whitespace-nowrap text-[11px] font-semibold";
  if (run) return <span className={cn(word, run === "failed" ? "text-error-strong" : "text-text-secondary")}>{RUN[run]}</span>;
  if (d.severity === "inconclusive") return <span className={cn(word, "text-text-secondary")}>Not captured</span>;
  if (d.severity === "clean") return <span className={cn(word, "text-success-strong")}>Clean</span>;
  return (
    <span className="flex gap-2">
      {d.errors > 0 && <span className={cn(word, "text-error-strong")}>{d.errors} error{d.errors === 1 ? "" : "s"}</span>}
      {d.warnings > 0 && <span className={cn(word, "text-warning-strong")}>{d.warnings} warning{d.warnings === 1 ? "" : "s"}</span>}
    </span>
  );
}

export function HealthMatrix({
  views,
  findingsOf,
  statusOf,
  selected,
  onPick,
  runState,
}: {
  views: DeviceView[];
  /** The raw findings for a profile — the cells are computed from them. */
  findingsOf: (profileId: string) => Finding[];
  statusOf: (profileId: string) => string;
  selected: string | null;
  onPick: (profileId: string) => void;
  /** While a run is on: what the service has said about each device so far. */
  runState?: (d: DeviceView) => DeviceRunState | null;
}) {
  // Which build of the service took these captures, asked when the panel is
  // opened and not before. A panel about what the fleet did is where "and is
  // the fleet the one I merged" belongs.
  const [health, setHealth] = useState<ServiceHealth | null>(null);
  useEffect(() => {
    let alive = true;
    fetch("/api/devicepreview/monitor?view=health", { cache: "no-store" })
      .then((r) => r.json())
      .then((h) => { if (alive) setHealth(h as ServiceHealth); })
      .catch(() => { if (alive) setHealth({ unavailable: true }); });
    return () => { alive = false; };
  }, []);
  const line = serviceLine(health, process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA);

  const groups = groupDevices(views);
  const all = groups.flatMap((g) => g.devices);
  const tabTarget = all.some((d) => d.profileId === selected) ? selected : all[0]?.profileId ?? null;
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const j = rovingTarget(e.key, all.findIndex((d) => d.profileId === selected), all.length);
    if (j === null) return;
    e.preventDefault();
    onPick(all[j].profileId);
    document.getElementById(`hm-${all[j].profileId}`)?.focus();
  };
  const cols = "grid-cols-[minmax(0,1fr)_auto] @3xl:grid-cols-[minmax(200px,1fr)_repeat(6,64px)_minmax(150px,auto)]";

  return (
    <div className="@container" role="radiogroup" aria-label="Device health" onKeyDown={onKey}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex flex-wrap items-baseline gap-x-4">
          <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-text-secondary">Device health</span>
          <span className="text-[13px] text-text-secondary">{views.length} devices · {CHECKS.length} checks · pick a row to open that device</span>
        </div>
        <div className="hidden items-center gap-4 text-[11px] text-text-secondary @3xl:flex">
          <span className="flex items-center gap-2"><i className={cn("inline-block size-3 rounded", CELL.error)} />errors</span>
          <span className="flex items-center gap-2"><i className={cn("inline-block size-3 rounded", CELL.warning)} />warnings</span>
          <span className="flex items-center gap-2"><i className={cn("inline-block size-3 rounded", CELL.clean)} />clean</span>
          <span className="flex items-center gap-2"><i className="inline-block size-3 rounded border border-dashed border-text-secondary" />can&apos;t measure here</span>
        </div>
      </div>

      <div className={cn("hidden h-8 items-center @3xl:grid", cols)} aria-hidden>
        <span />
        {CHECKS.map((c) => (
          <span key={c.id} className="text-center text-[11px] font-semibold uppercase tracking-[0.08em] text-text-secondary">{c.label}</span>
        ))}
        <span className="pl-4 text-[11px] font-semibold uppercase tracking-[0.08em] text-text-secondary">Verdict</span>
      </div>

      {groups.map(({ group, devices }) => (
        <div key={group} className="flex flex-col">
          <span className="px-4 pt-4 text-[11px] font-semibold uppercase tracking-[0.08em] text-text-secondary">{group}</span>
          {devices.map((d) => {
            const on = d.profileId === selected;
            const run = runState?.(d) ?? null;
            const cells = cellsFor({ engine: d.engine, status: statusOf(d.profileId), findings: findingsOf(d.profileId) });
            const words = cells.map((c, i) => cellWords(c, CHECKS[i])).join("; ");
            return (
              <div
                key={d.profileId}
                id={`hm-${d.profileId}`}
                role="radio"
                aria-checked={on}
                aria-label={`${d.label}, ${d.engineLabel}${run ? `, ${RUN[run]}` : `. ${words}`}`}
                tabIndex={d.profileId === tabTarget ? 0 : -1}
                onClick={() => onPick(d.profileId)}
                className={cn(
                  "grid h-10 cursor-pointer items-center rounded-lg transition-colors focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-text-primary",
                  cols,
                  on ? "bg-accent/[0.06] shadow-[inset_3px_0_0_var(--color-accent)]" : "hover:bg-card",
                  run === "waiting" && "opacity-60",
                )}
              >
                <span className="flex min-w-0 flex-col pl-4">
                  <span className={cn("truncate text-[13px] leading-tight", on ? "font-semibold text-accent" : "font-medium text-text-primary")}>{d.label}</span>
                  <span className="truncate text-[11px] leading-tight text-text-secondary">{d.engineLabel} · {d.viewportLabel}</span>
                </span>
                {cells.map((c, i) => (
                  <span key={c.check} className="hidden place-items-center @3xl:grid" title={cellWords(c, CHECKS[i])} aria-hidden>
                    {run ? (
                      <i className="size-7 rounded-md bg-card-soft" />
                    ) : c.tone === "na" ? (
                      <i className="text-[13px] leading-none text-text-secondary">—</i>
                    ) : (
                      <i className={cn("grid size-7 place-items-center rounded-md text-[12px] font-semibold tabular-nums not-italic", CELL[c.tone])}>
                        {c.tone === "clean" ? <Tick /> : c.count}
                      </i>
                    )}
                  </span>
                ))}
                <span className="px-4"><Verdict d={d} run={run} /></span>
              </div>
            );
          })}
        </div>
      ))}
      {line && <p className="mt-4 text-[11px] leading-4 text-text-secondary">{line}</p>}
    </div>
  );
}
