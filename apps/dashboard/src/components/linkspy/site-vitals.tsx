"use client";

import { useState } from "react";
import { AlertTriangle, Check, CheckCircle2, ChevronDown, HelpCircle, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { VitalCard, VitalEscalation } from "@/lib/linkspy/sites-view";
import {
  badChecks,
  cardSummary,
  overviewVerdict,
  partitionCards,
  remedyFor,
} from "@/lib/linkspy/vitals-view";

// The site Overview's nine checks.
//
// Severity decides three things here and nothing else does: the order, the
// size, and whether a card appears at all. Four green tiles taking a full row
// to say nothing was the largest waste on this page, so passing checks
// collapse into one quiet line.
//
// Colour is severity's alone. The accent is for interactive and selected
// states, so when red appears it means exactly one thing.

const VERDICT_TONE = {
  error: { text: "text-error-strong", Icon: XCircle },
  warning: { text: "text-warning-strong", Icon: AlertTriangle },
  success: { text: "text-success-strong", Icon: CheckCircle2 },
  neutral: { text: "text-text-secondary", Icon: HelpCircle },
} as const;

// The 3px left edge, instead of a badge in the corner. More scannable, and it
// lets every card drop one element.
const EDGE: Record<VitalEscalation, string> = {
  critical: "bg-error",
  warn: "bg-warning",
  notice: "bg-text-muted",
  unknown: "bg-border-soft",
  ok: "bg-success",
};

// Raw severity colours are for bars and fills. As text they are 2–3.4:1 on
// white, so the -strong tokens carry every word.
const CHECK_TEXT: Record<VitalEscalation, string> = {
  critical: "text-error-strong",
  warn: "text-warning-strong",
  notice: "text-text-secondary",
  unknown: "text-text-secondary",
  ok: "text-success-strong",
};

export function SiteVitals({ cards }: { cards: VitalCard[] }) {
  const [openStrip, setOpenStrip] = useState(false);
  const verdict = overviewVerdict(cards);
  const { attention, passing } = partitionCards(cards);
  const { text, Icon } = VERDICT_TONE[verdict.tone];

  return (
    <section className="flex flex-col gap-6">
      {/* The verdict — same voice and scale as the Layout checks report, so
          the two pages read as one product. Tone by type and icon colour, not
          a filled bar: this is a statement of fact, not an alert component. */}
      <div className="flex flex-col gap-2">
        <div className="flex items-start gap-3">
          <Icon className={cn("mt-1 size-6 shrink-0", text)} strokeWidth={2} aria-hidden />
          <h2 className={cn("text-[24px] font-semibold leading-tight tracking-tight text-balance", text)}>
            {verdict.headline}
          </h2>
        </div>
        {verdict.urgent && (
          <p className="max-w-[70ch] pl-9 text-[14px] leading-relaxed text-text-secondary">
            {verdict.urgent}
          </p>
        )}
      </div>

      {attention.length > 0 && (
        <div className="grid grid-cols-1 items-start gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {attention.map((card) => (
            <VitalTile key={card.key} card={card} />
          ))}
        </div>
      )}

      {passing.length > 0 && (
        <PassingStrip cards={passing} open={openStrip} onToggle={() => setOpenStrip((v) => !v)} />
      )}
    </section>
  );
}

function VitalTile({ card }: { card: VitalCard }) {
  const bad = badChecks(card);
  const { count } = cardSummary(card);
  const lead = card.escalation === "critical";
  // The critical card spans two columns and takes larger type, so it is
  // unmistakably the first thing on the screen.
  return (
    <article
      className={cn(
        "relative overflow-hidden rounded-xl bg-card px-5 py-4 transition-colors hover:bg-card-soft",
        lead && "sm:col-span-2",
      )}
    >
      <span className={cn("absolute inset-y-0 left-0 w-[3px]", EDGE[card.escalation])} aria-hidden />
      {/* text-secondary, not text-muted: #7a7a8c is 4.21:1 on white and AA
          asks 4.5 for text this size. Hierarchy comes from size and weight. */}
      <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-text-secondary">
        {card.label}
      </p>
      <p
        className={cn(
          "mt-1 font-semibold leading-tight text-text-primary",
          lead ? "text-[28px]" : "text-[18px]",
        )}
      >
        {card.fact}
      </p>

      {/* When the findings are listed below, a summary line above them is the
          same information twice — the fault this redesign exists to remove.
          The count is already in the value ("2 to fix"). The summary is the
          fallback for a payload with no checks, where the old code truncated
          a joined string mid-word: the count and the worst one whole instead. */}
      {count === 0 && card.detail && (
        <p className="mt-2 text-[13px] leading-snug text-text-secondary">
          {card.detail}
        </p>
      )}

      {/* Every finding gets its remedy. A finding says something is wrong; a
          remedy lets someone act on it. */}
      {bad.length > 0 && (
        <ul
          className={cn(
            "mt-3 flex flex-col gap-2.5",
            // The lead card is given two columns; its findings should use
            // them rather than leaving half the card empty.
            lead && "sm:grid sm:grid-cols-2 sm:gap-x-6",
          )}
        >
          {bad.slice(0, lead ? 5 : 3).map((check, i) => {
            const remedy = remedyFor(check.text);
            return (
              <li key={`${check.key ?? check.text}-${i}`} className="flex flex-col gap-0.5">
                <span className={cn("text-[13px] leading-snug", CHECK_TEXT[check.status])}>
                  {check.text}
                </span>
                {remedy && (
                  <span className="text-[12px] leading-snug text-text-secondary">{remedy}</span>
                )}
              </li>
            );
          })}
          {bad.length > (lead ? 5 : 3) && (
            <li className="text-[12px] text-text-secondary">
              and {bad.length - (lead ? 5 : 3)} more
            </li>
          )}
        </ul>
      )}
    </article>
  );
}

function PassingStrip({
  cards,
  open,
  onToggle,
}: {
  cards: VitalCard[];
  open: boolean;
  onToggle: () => void;
}) {
  // Green states should be reassuring and quiet, not loud and space-consuming.
  return (
    <div className="rounded-xl bg-card">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full flex-wrap items-center gap-x-4 gap-y-1.5 rounded-xl px-5 py-3 text-left transition-colors hover:bg-card-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        <Check className="size-4 shrink-0 text-success-strong" strokeWidth={2.5} aria-hidden />
        {cards.map((c) => (
          <span key={c.key} className="text-[13px] text-text-secondary">
            <span className="font-medium text-text-primary">{c.label}</span> {c.fact}
          </span>
        ))}
        <ChevronDown
          className={cn(
            "ml-auto size-4 shrink-0 text-text-muted transition-transform duration-200",
            open && "rotate-180",
          )}
          aria-hidden
        />
      </button>
      <div
        className={cn(
          "grid transition-[grid-template-rows] duration-200 ease-out",
          open ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
        )}
      >
        <div className="overflow-hidden">
          <ul className="flex flex-col gap-2 px-5 pb-4 pt-1">
            {cards.map((c) => (
              <li key={c.key} className="flex flex-wrap items-baseline gap-x-2 text-[13px]">
                <span className="font-medium text-text-primary">{c.label}</span>
                <span className="text-text-secondary">{c.fact}</span>
                {c.detail && <span className="text-text-secondary">· {c.detail}</span>}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
