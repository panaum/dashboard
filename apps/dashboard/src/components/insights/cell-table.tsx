import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { bandFor, MIN_N, type Band, type Cell, type Confidence } from "@/lib/metrics";
import { Sparkline } from "./sparkline";

// EVERY NUMBER ARRIVES WITH ITS n, AND EVERY FIGURE IS SET IN THE MONO.
//
// The old page ranked seven developers on as few as one page each and printed
// the winner in bold. A cell whose sample cannot carry a ranking is rendered
// here HATCHED — present, its n visible, diagonally struck through. A blank
// would read as "did no work" and a zero would read as "perfect"; the hatch
// reads as withheld, which is what it is.
//
// Rows are 40px with 16px cell padding, numerics right-aligned on a tabular
// mono so the decimal points form a vertical rule. Dividers are the hairline
// at 40%. No zebra striping: banding rows colours something that carries no
// meaning, and this system spends colour only where it means something.

const ROW = "grid h-10 items-center gap-4 px-4";

// Colour never carries the band alone — each step has a glyph too, and the
// rows are already sorted, so position carries it a third time.
//
// The MIDDLE step is deliberately not amber. The band is a ratio of the
// period mean, so most values land in it by construction: on real data that
// painted eleven of sixteen rows amber, which reads as an alarm about being
// average. Colour is spent on the exceptions at either end and the typical
// case is left in plain ink — the glyph still distinguishes it.
const BAND_GLYPH: Record<Band, string> = { good: "▾", watch: "–", poor: "▴" };
const BAND_INK: Record<Band, string> = {
  good: "text-[var(--good)]",
  watch: "text-[var(--ink)]",
  poor: "text-[var(--poor)]",
};

export function BandedFigure({ value, mean }: { value: number | null; mean: number | null }) {
  const band = bandFor(value, mean);
  if (value === null) return <span className="text-[var(--ink-3)]">—</span>;
  return (
    <span className={cn("fig inline-flex items-center gap-1.5", band ? BAND_INK[band] : "text-[var(--ink)]")}>
      {band && <span aria-hidden className="text-[9px] leading-none">{BAND_GLYPH[band]}</span>}
      <span className="font-medium">{value}</span>
      {band && <span className="sr-only">({band})</span>}
    </span>
  );
}

// THE FIGURE, WITH ITS SIZE BEHIND IT.
//
// 13.17 against 1.43 is a ratio of nine, and reading two numbers to work that
// out is slower than seeing it. The bar is scaled to one maximum shared by the
// whole column — scaling each row to itself is the classic in-table bar lie,
// where every row fills its cell and the column says nothing.
//
// It sits BEHIND the number rather than beside it, so the column of decimals
// stays a straight edge.
export function BarFigure({
  value, mean, max, delay,
}: {
  value: number | null;
  mean: number | null;
  max: number;
  delay: number;
}) {
  const band = bandFor(value, mean);
  const pct = value === null || max <= 0 ? 0 : Math.min(100, (value / max) * 100);
  const fill =
    band === "poor" ? "var(--poor)" : band === "good" ? "var(--good)" : "var(--focus)";
  return (
    <span className="relative flex items-center justify-end">
      <span
        aria-hidden
        style={{ width: `${pct}%`, background: fill, animationDelay: `${delay}ms` }}
        className="t-grow absolute inset-y-[3px] right-0 rounded-[var(--r-bar)] opacity-[0.16]"
      />
      <span className="relative pr-1.5">
        <BandedFigure value={value} mean={mean} />
      </span>
    </span>
  );
}

export function ConfidenceMark({ c, n }: { c: Confidence; n: number }) {
  if (c === "high") return null;
  const text = c === "blocked" ? "not captured" : c === "insufficient" ? `n=${n}` : "indicative";
  return (
    <span
      className="t-micro shrink-0 rounded-[var(--r-chip)] border border-[var(--hairline-strong)] px-1.5 py-px text-[10px] tracking-[0.04em]"
      title={
        c === "insufficient"
          ? `Fewer than ${MIN_N} pages — shown, but not ranked.`
          : c === "blocked"
            ? "No field behind this metric."
            : "Adjusted against too few reviewers to be more than indicative."
      }
    >
      {text}
    </span>
  );
}

/** One scale for a whole column, from the rankable rows only — a single n=1
 *  outlier at 50 issues/page would otherwise flatten every real bar. Exported
 *  so a table supplying its own columns still shares the table's scale. */
export function scaleOf(cells: Cell[]): number {
  return Math.max(0, ...cells.filter((c) => c.confidence === "high").map((c) => c.value ?? 0));
}

export type Column<T extends Cell = Cell> = {
  head: string;
  /** Right-aligned numerics are the default; a text column opts out. */
  align?: "left";
  width?: string;
  render: (c: T, index: number) => React.ReactNode;
};

export function CellTable<T extends Cell>({
  cells,
  label,
  columns,
  unit,
  mean,
  series,
  hrefFor,
  emptyNote = "Nothing in this scope.",
  collapseAfter = 5,
}: {
  cells: T[];
  label: (key: string) => string;
  columns?: Column<T>[];
  /** The unit, stated once in the header rather than repeated per row. */
  unit?: string;
  /** The period mean, which the three-step ramp is measured against. */
  mean?: number | null;
  /** Per-row month series, aligned to the period — draws a sparkline column. */
  series?: Map<string, (number | null)[]>;
  hrefFor?: (key: string) => string | null;
  emptyNote?: string;
  /** Past this many withheld rows, fold them away. 81 unrankable clients in a
   *  column is honest and unreadable; a disclosure is both. */
  collapseAfter?: number;
}) {
  if (cells.length === 0) {
    return (
      <div className="panel flex h-24 items-center justify-center">
        <p className="t-body text-[var(--ink-2)]">{emptyNote}</p>
      </div>
    );
  }

  // One scale for the whole column, from the rankable rows only — a single
  // n=1 outlier at 50 issues/page would otherwise flatten every real bar.
  const scale = Math.max(
    0,
    ...cells.filter((c) => c.confidence === "high").map((c) => c.value ?? 0),
  );
  // "vs prev" is dropped entirely when no row has a previous period to compare
  // against — on the all-time scope that was 96 rows of em-dash.
  const hasPrev = cells.some((c) => c.previousPeriodValue !== null);
  const seriesMax = Math.max(
    0,
    ...[...(series?.values() ?? [])].flat().map((v) => v ?? 0),
  );

  const cols: Column<T>[] =
    columns ?? [
      { head: "n", width: "3rem", render: (c) => <span className="fig text-[var(--ink-2)]">{c.n}</span> },
      {
        head: unit ?? "value",
        width: "8rem",
        render: (c, i) => <BarFigure value={c.value} mean={mean ?? null} max={scale} delay={i * 40} />,
      },
      ...(series
        ? [{
            head: "trend",
            width: "5rem",
            render: (c: T) => (
              <span className="flex justify-end">
                <Sparkline
                  values={series.get(c.key) ?? []}
                  max={seriesMax}
                  tone={bandFor(c.value, mean ?? null) === "poor" ? "poor" : "neutral"}
                  label={`${label(c.key)} by month`}
                />
              </span>
            ),
          } as Column<T>]
        : []),
      ...(hasPrev
        ? [{
            head: "vs prev",
            width: "5rem",
            render: (c: T) => <Delta now={c.value} before={c.previousPeriodValue} />,
          } as Column<T>]
        : []),
    ];
  const grid = { gridTemplateColumns: `minmax(0,1fr) ${cols.map((c) => c.width ?? "5rem").join(" ")}` };

  const withheld = (c: T) => c.confidence === "insufficient" || c.confidence === "blocked";
  const fold = cells.filter(withheld).length > collapseAfter;
  const ranked = fold ? cells.filter((c) => !withheld(c)) : cells;
  const folded = fold ? cells.filter(withheld) : [];

  return (
    <div className="panel overflow-hidden">
      <div
        className={cn(ROW, "t-micro h-8 border-b border-[var(--hairline)] text-[var(--ink-3)]")}
        style={grid}
      >
        <span>name</span>
        {cols.map((c) => (
          <span key={c.head} className={c.align === "left" ? "text-left" : "text-right"}>
            {c.head}
          </span>
        ))}
      </div>

      {ranked.map((cell, i) => row(cell, i))}

      {folded.length > 0 && (
        <details className="group border-t border-[var(--hairline)]">
          <summary
            className={cn(
              ROW,
              "t-body cursor-pointer list-none text-[var(--ink-2)] transition-colors hover:bg-[var(--surface-sunken)]",
            )}
            style={{ gridTemplateColumns: "auto minmax(0,1fr)" }}
          >
            <ChevronRight className="size-3.5 transition-transform group-open:rotate-90" strokeWidth={2} />
            <span>
              <span className="fig">{folded.length}</span> more below{" "}
              <span className="fig">{MIN_N}</span> pages — withheld, not ranked
            </span>
          </summary>
          <div className="border-t border-[var(--hairline)] bg-[var(--surface-sunken)]">
            {folded.map((cell, i) => row(cell, i))}
          </div>
        </details>
      )}
    </div>
  );

  function row(cell: T, i: number) {
    const out = withheld(cell);
    const href = hrefFor?.(cell.key) ?? null;
    const name = <span className="truncate text-[13px] text-[var(--ink)]">{label(cell.key)}</span>;
    return (
      <div
        key={cell.key}
        style={{ ...grid, animationDelay: `${Math.min(i, 12) * 40}ms` }}
        className={cn(ROW, "rule-row t-in", out && "hatched")}
      >
        <span className="flex min-w-0 items-center gap-2">
          {href ? (
            <Link href={href} className="min-w-0 truncate hover:underline">
              {name}
            </Link>
          ) : (
            name
          )}
          <ConfidenceMark c={cell.confidence} n={cell.n} />
        </span>
        {cols.map((c) => (
          <span
            key={c.head}
            className={cn("text-[13px]", c.align === "left" ? "text-left" : "text-right")}
          >
            {c.render(cell, i)}
          </span>
        ))}
      </div>
    );
  }
}

/** Direction is what matters on a defect rate, and down is good — so this
 *  reads the sign against the metric, never as plain positive/negative, and
 *  pairs the colour with an arrow. */
export function Delta({ now, before }: { now: number | null; before: number | null }) {
  if (now === null || before === null) return <span className="fig text-[var(--ink-3)]">—</span>;
  const d = Math.round((now - before) * 100) / 100;
  if (d === 0) return <span className="t-body text-[var(--ink-3)]">level</span>;
  const better = d < 0;
  return (
    <span className={cn("fig", better ? "text-[var(--good)]" : "text-[var(--watch)]")}>
      <span aria-hidden className="mr-1 text-[9px]">{better ? "▾" : "▴"}</span>
      {d > 0 ? "+" : ""}
      {d}
    </span>
  );
}
