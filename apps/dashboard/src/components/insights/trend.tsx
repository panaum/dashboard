import { cn } from "@/lib/utils";
import { monthLabel } from "@/lib/constants";
import { bandFor, BAND_THRESHOLDS, MIN_N, type Cell } from "@/lib/metrics";

// THE TREND, DRAWN TO THE SCALE.
//
// Craft rules this follows, each of which the old chart broke:
//
//  · The axis is a hairline, not a black rule, and there are no gridlines —
//    with a direct label on every bar there is nothing left for them to do.
//  · Every bar is labelled on the mark. There is no legend, because a legend
//    is what you add when direct labelling failed.
//  · The unit is stated once, in the header, not repeated eleven times.
//  · n appears in the footnote, per the rule that every chart shows its n.
//  · A month below MIN_N pages is HATCHED with its reason on hover — never a
//    gap (which reads as "nothing shipped") and never a zero (which reads as
//    "nothing went wrong").
//  · Bars are NOT coloured to fill them. Height already encodes the value and
//    the dashed rule already says which side of the mean it falls, so banding
//    every bar painted seven of nine amber and said nothing. They are graphite;
//    only a month that runs above the poor threshold takes colour, which is
//    what makes that one bar mean something.

export function Trend({ months, mean }: { months: Cell[]; mean: number | null }) {
  const values = months.map((m) => m.value ?? 0);
  const max = Math.max(1, ...values);
  const total = months.reduce((n, m) => n + m.n, 0);
  const meanPct = mean !== null && max > 0 ? Math.min(100, (mean / max) * 100) : null;

  return (
    <section className="panel t-in p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="t-card">Quality trend</h2>
        <span className="t-micro">issues per page · by delivery month</span>
      </div>

      <div className="relative mt-6 flex items-end gap-2" style={{ height: 148 }}>
        {/* The mean, as a rule rather than a labelled rule: an inline label
            at the right edge collided with the last bar, and the footnote
            already names the number. */}
        {meanPct !== null && (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 border-t border-dashed border-[var(--ink-3)]"
            style={{ bottom: `calc(28px + ${meanPct} * 1.04px)` }}
          />
        )}

        {months.map((m, i) => {
          const thin = m.confidence !== "high";
          const band = thin ? null : bandFor(m.value, mean);
          const h = Math.max(3, Math.round(((m.value ?? 0) / max) * 104));
          return (
            <div key={m.key} className="flex min-w-0 flex-1 flex-col items-center justify-end gap-2">
              <span
                className={cn(
                  "fig text-[11px]",
                  thin ? "text-[var(--ink-3)]" : "text-[var(--ink)]",
                )}
              >
                {m.value}
              </span>
              <div
                title={
                  thin
                    ? `${m.n} page${m.n === 1 ? "" : "s"} — fewer than ${MIN_N}, so this month is withheld from the ranking`
                    : `${m.value} issues per page over ${m.n} pages`
                }
                style={{ height: h, animationDelay: `${i * 40}ms` }}
                className={cn(
                  "t-in w-full max-w-[34px] rounded-t-[var(--r-bar)] transition-opacity hover:opacity-80",
                  thin
                    ? "hatched border border-[var(--hairline-strong)]"
                    : band === "poor"
                      ? "bg-[var(--poor)]"
                      : "bg-[color-mix(in_srgb,var(--ink)_70%,transparent)]",
                )}
              />
              <span className="t-micro truncate text-[10px] text-[var(--ink-3)]">
                {monthLabel(m.key).slice(0, 3)}
              </span>
            </div>
          );
        })}
      </div>

      {/* The axis: one hairline, and the only rule on the chart. */}
      <div className="h-px bg-[var(--hairline-strong)]" />

      <p className="t-body mt-3 text-[var(--ink-3)]">
        <span className="fig">{total}</span> pages across{" "}
        <span className="fig">{months.length}</span> months. Dashed rule is the period mean,{" "}
        <span className="fig">{mean}</span> issues per page; a coloured bar runs above{" "}
        <span className="fig">{BAND_THRESHOLDS.watch}×</span> it.
        {months.some((m) => m.confidence !== "high") && " Hatched months carry too few pages to rank."}
      </p>
    </section>
  );
}
