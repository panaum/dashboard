import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { AddMonth } from "@/components/reports/add-month";
import { cn } from "@/lib/utils";

const MONTHS_ABBR = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/**
 * Calendar-style month navigation for the Monthly report: a year switcher plus a
 * fixed 12-month row for that year. Every month is always visible (no gaps) —
 * months with delivered pages show their count; empty ones are muted. Selection
 * is driven entirely by the `?month=YYYY-MM` param, so the year arrows just move
 * to the same month in the adjacent year.
 */
export function MonthStrip({
  year,
  selected,
  counts,
}: {
  year: string;
  selected: string; // "YYYY-MM" — the currently viewed month
  counts: Record<string, number>; // month number "01".."12" → pages delivered
}) {
  const selMM = selected.slice(5, 7);
  const selInYear = selected.slice(0, 4) === year;
  const prevYear = String(Number(year) - 1);
  const nextYear = String(Number(year) + 1);

  return (
    <div className="mb-6 flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <div className="inline-flex items-center gap-1 rounded-full border border-border-soft bg-card px-1 py-1">
          <Link
            href={`/dashboard/reports?month=${prevYear}-${selMM}`}
            aria-label={`Go to ${prevYear}`}
            className="rounded-full p-1 text-text-secondary transition-colors hover:bg-card-soft hover:text-text-primary"
          >
            <ChevronLeft className="size-4" />
          </Link>
          <span className="min-w-14 text-center text-[13px] font-semibold tabular-nums text-text-primary">
            {year}
          </span>
          <Link
            href={`/dashboard/reports?month=${nextYear}-${selMM}`}
            aria-label={`Go to ${nextYear}`}
            className="rounded-full p-1 text-text-secondary transition-colors hover:bg-card-soft hover:text-text-primary"
          >
            <ChevronRight className="size-4" />
          </Link>
        </div>
        <AddMonth />
      </div>

      <div className="grid grid-cols-6 gap-2 sm:grid-cols-12">
        {MONTHS_ABBR.map((abbr, i) => {
          const mm = String(i + 1).padStart(2, "0");
          const count = counts[mm] ?? 0;
          const active = selInYear && selMM === mm;
          const hasData = count > 0;
          return (
            <Link
              key={mm}
              href={`/dashboard/reports?month=${year}-${mm}`}
              className={cn(
                "flex flex-col items-center gap-1 rounded-lg border px-2 py-2 text-center transition-all",
                active
                  ? "border-accent bg-accent text-text-on-dark shadow-sm"
                  : hasData
                    ? "border-border-soft bg-card text-text-primary hover:-translate-y-0.5 hover:border-accent/40"
                    : "border-border-soft/60 bg-card/60 text-text-muted hover:border-accent/30 hover:text-text-secondary",
              )}
            >
              <span className="text-[13px] font-semibold leading-none">
                {abbr}
              </span>
              <span
                className={cn(
                  "text-[11px] leading-none tabular-nums",
                  active
                    ? "text-text-on-dark/80"
                    : hasData
                      ? "text-text-secondary"
                      : "text-text-muted/70",
                )}
              >
                {hasData ? count : "·"}
              </span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
