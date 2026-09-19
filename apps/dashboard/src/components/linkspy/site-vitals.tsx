"use client";

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Check, ChevronDown, HelpCircle, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { VitalCard, VitalEscalation } from "@/lib/linkspy/sites-view";
import { OWNER_LABEL, SURFACE_LABEL, type Surface } from "@/lib/linkspy/check-roles";
import {
  SEVERITY_RANK, bySurface, findingsOf, passingLine, unknownCards, type Finding,
} from "@/lib/linkspy/vitals-view";

// The site Overview: one prioritised list of work.
//
// It used to be nine cards — our internal taxonomy of checkers, one box each,
// with a green Uptime tile given the same weight as a critical email failure.
// Nobody reads a page that way. They want to know how much there is to do and
// what to do first.
//
// The screenshot rail from the full design is not here, and cannot be yet: no
// sentinel check records which element it failed on, so there is nothing to
// pin. #170 covers keeping the selectors the guards already find. The list is
// the degraded path by design, and it degrades cleanly.

const SEVERITY_TEXT: Record<VitalEscalation, string> = {
  critical: "text-error-strong",
  warn: "text-warning-strong",
  notice: "text-text-secondary",
  unknown: "text-text-secondary",
  ok: "text-success-strong",
};

// A wash of the severity colour behind the row, at 8%. Colour here is not
// decoration: it is the same signal as the edge bar, given more surface so the
// page reads at a glance instead of as a grey list.
//
// Measured, not eyeballed. On white the composites are #fdf2f2, #fef8ed and
// #f1f9f5, and the severity text still reads 5.96, 5.99 and 4.97 against them
// — all over the 4.5 AA needs. `notice` stays untinted on purpose: a grey wash
// on a grey page is mud, and leaving it plain is what lets the other two pop.
const SEVERITY_TINT: Record<VitalEscalation, string> = {
  critical: "bg-error/[0.08] hover:bg-error/[0.14]",
  warn: "bg-warning/[0.08] hover:bg-warning/[0.14]",
  notice: "hover:bg-card-soft",
  unknown: "hover:bg-card-soft",
  ok: "bg-success/[0.08] hover:bg-success/[0.14]",
};

const SEVERITY_EDGE: Record<VitalEscalation, string> = {
  critical: "bg-error",
  warn: "bg-warning",
  notice: "bg-text-muted",
  unknown: "bg-border-soft",
  ok: "bg-success",
};

/** Counts up once, on first paint only. A number that re-animates every time
 *  the data refreshes is infuriating, so this never runs twice. */
function useCountUp(target: number, ms = 400): number {
  const [value, setValue] = useState(target);
  const done = useRef(false);
  useEffect(() => {
    if (done.current) return;
    done.current = true;
    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduced || target <= 0) return;
    setValue(0);
    const start = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / ms);
      setValue(Math.round(target * (1 - (1 - t) ** 3)));   // ease-out
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, ms]);
  return value;
}

export function SiteVitals({ cards }: { cards: VitalCard[] }) {
  const findings = findingsOf(cards);
  const split = bySurface(findings);
  // Severity stays primary; the grouping is secondary. Ordering the groups by
  // where the fix lives would bury a critical under two warnings, which is the
  // one thing this page exists to prevent — so the group holding the worst
  // finding leads, and `findingsOf` has already sorted within each.
  const groups: Array<[Surface | null, Finding[]]> = (
    [["page", split.page],
     ["infrastructure", split.infrastructure],
     [null, split.unclassified]] as Array<[Surface | null, Finding[]]>
  )
    .filter(([, rows]) => rows.length > 0)
    .sort(([, a], [, b]) => SEVERITY_RANK[a[0].status] - SEVERITY_RANK[b[0].status]);
  const groupCount = groups.length;
  const unknown = unknownCards(cards);
  const passing = passingLine(cards);
  const [openId, setOpenId] = useState<string | null>(null);
  const shown = useCountUp(findings.length);

  return (
    <section className="flex flex-col gap-6">
      <Header count={findings.length} shown={shown} />

      {groups.map(([surface, rows]) => (
        <div key={surface ?? "unclassified"} className="flex flex-col gap-2">
          {/* The heading names where the FIX lives, never where the fault is
              on the page — nothing here records a selector (#170). */}
          {surface && groupCount > 1 && (
            <h3 className="px-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-text-secondary">
              {SURFACE_LABEL[surface]}
            </h3>
          )}
          <FindingsList
            findings={rows}
            openId={openId}
            onToggle={(id) => setOpenId((cur) => (cur === id ? null : id))}
          />
        </div>
      ))}

      {unknown.length > 0 && (
        <div className="flex flex-col gap-2 rounded-xl bg-card px-5 py-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-text-secondary">
            Not established
          </p>
          {/* "We could not check this" is not a pass and never folds in with
              the green line below. */}
          {unknown.map((c) => (
            <p key={c.key} className="flex items-start gap-2 text-[13px]">
              <HelpCircle className="mt-0.5 size-3.5 shrink-0 text-text-secondary" aria-hidden />
              {/* One text flow, so a wrapped second line stays left-aligned
                  under the first rather than centring itself in the row. */}
              <span className="min-w-0 text-text-secondary">
                <span className="text-text-primary">{c.label}</span>{" "}
                {c.detail ?? c.fact}
              </span>
            </p>
          ))}
        </div>
      )}

      {passing && (
        <p className="flex items-center gap-2 rounded-xl bg-success/[0.08] px-4 py-3 text-[13px] text-text-secondary">
          <Check className="size-4 shrink-0 text-success-strong" strokeWidth={2.5} aria-hidden />
          {passing}
        </p>
      )}
    </section>
  );
}

function Header({ count, shown }: { count: number; shown: number }) {
  if (count === 0) {
    return (
      <h2 className="flex items-center gap-3 text-[24px] font-semibold leading-tight tracking-tight text-success-strong">
        <Check className="size-6 shrink-0" strokeWidth={2.5} aria-hidden />
        Nothing to fix
      </h2>
    );
  }
  return (
    <h2 className="text-[28px] font-semibold leading-tight tracking-tight text-text-primary">
      {/* The count of WORK, not of checks. An audit statistic tells you how
          thorough we were; this tells you about your afternoon. */}
      <span className="tabular-nums">{shown}</span> to fix
    </h2>
  );
}

function FindingsList({
  findings,
  openId,
  onToggle,
}: {
  findings: Finding[];
  openId: string | null;
  onToggle: (id: string) => void;
}) {
  const refs = useRef(new Map<string, HTMLButtonElement>());

  // Arrows walk the list; the list itself is one tab stop away from being a
  // keyboard trap, so every row stays tabbable and arrows are the shortcut.
  const onKeyDown = (e: React.KeyboardEvent, index: number) => {
    const delta = e.key === "ArrowDown" ? 1 : e.key === "ArrowUp" ? -1 : 0;
    if (!delta) return;
    e.preventDefault();
    const next = findings[(index + delta + findings.length) % findings.length];
    refs.current.get(next.id)?.focus();
  };

  return (
    <ul className="flex flex-col gap-px overflow-hidden rounded-xl bg-card">
      {findings.map((f, i) => {
        const open = openId === f.id;
        return (
          <li key={f.id} className={cn("relative transition-colors", SEVERITY_TINT[f.status])}>
            <span
              className={cn("absolute inset-y-0 left-0 w-[3px]", SEVERITY_EDGE[f.status])}
              aria-hidden
            />
            <button
              type="button"
              ref={(el) => {
                if (el) refs.current.set(f.id, el);
                else refs.current.delete(f.id);
              }}
              onClick={() => onToggle(f.id)}
              onKeyDown={(e) => onKeyDown(e, i)}
              aria-expanded={open}
              className="flex w-full items-start gap-3 py-3.5 pl-5 pr-4 text-left focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent"
            >
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className={cn("text-[14px] font-medium leading-snug", SEVERITY_TEXT[f.status])}>
                  {f.text}
                </span>
                {(f.role || f.remedy) && (
                  <span className="text-[12px] leading-snug text-text-secondary">
                    {f.role && (
                      <span className="font-medium">{OWNER_LABEL[f.role.owner]}</span>
                    )}
                    {f.role && f.remedy && " · "}
                    {f.remedy}
                  </span>
                )}
              </span>
              <ChevronDown
                className={cn(
                  "mt-0.5 size-4 shrink-0 text-text-secondary transition-transform duration-200",
                  open && "rotate-180",
                )}
                aria-hidden
              />
            </button>
            <div
              className={cn(
                "grid transition-[grid-template-rows] duration-[240ms] ease-out",
                open ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
              )}
            >
              <div className="overflow-hidden">
                <p className="pb-3.5 pl-5 pr-4 text-[12px] text-text-secondary">
                  Found by the {f.cardLabel} check.
                </p>
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
