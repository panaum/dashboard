import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { MIN_N, type Cell, type Confidence } from "@/lib/metrics";

// EVERY NUMBER ARRIVES WITH ITS n.
//
// The old page ranked seven developers on as few as one page each and printed
// the winner in bold. A cell whose sample cannot carry a ranking is rendered
// here as a suppressed row — present, greyed, with its n and the reason —
// never as a rank and never as an absence. Deleting the row would read as
// "this person did no work"; showing the number would read as a verdict.

export function ConfidenceMark({ c, n }: { c: Confidence; n: number }) {
  if (c === "high") return null;
  const text =
    c === "blocked" ? "not captured"
    : c === "insufficient" ? `n=${n}, too few to rank`
    : "indicative";
  return (
    <span
      className={cn(
        "shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium",
        c === "blocked" ? "bg-card-soft text-text-muted" : "bg-warning/[0.14] text-warning-strong",
      )}
    >
      {text}
    </span>
  );
}

export type Column<T extends Cell = Cell> = {
  head: string;
  /** Right-aligned numerics are the default; a name column opts out. */
  align?: "left";
  render: (c: T) => React.ReactNode;
};

export function CellTable<T extends Cell>({
  cells,
  label,
  columns,
  unit,
  hrefFor,
  emptyNote = "Nothing in this scope.",
  collapseAfter = 5,
}: {
  cells: T[];
  /** Turns a cell's key into something a person recognises. */
  label: (key: string) => string;
  columns?: Column<T>[];
  /** What the default value column is measuring, for the header. */
  unit?: string;
  hrefFor?: (key: string) => string | null;
  emptyNote?: string;
  /** Past this many suppressed rows, fold them away. Showing 81 unrankable
   *  clients in a row is honest and unreadable; a disclosure is both. */
  collapseAfter?: number;
}) {
  if (cells.length === 0) {
    return <p className="px-4 py-8 text-center text-[13px] text-text-secondary">{emptyNote}</p>;
  }
  const cols: Column<T>[] = columns ?? [
    { head: "n", render: (c) => <span className="tabular-nums text-text-secondary">{c.n}</span> },
    {
      head: unit ?? "value",
      render: (c) => (
        <span className="font-medium tabular-nums text-text-primary">
          {c.value === null ? "—" : c.value}
        </span>
      ),
    },
    {
      head: "vs prev",
      render: (c) => <Delta now={c.value} before={c.previousPeriodValue} />,
    },
  ];

  const isSuppressed = (c: T) => c.confidence === "insufficient" || c.confidence === "blocked";
  const suppressedCount = cells.filter(isSuppressed).length;
  const fold = suppressedCount > collapseAfter;
  const ranked = fold ? cells.filter((c) => !isSuppressed(c)) : cells;
  const folded = fold ? cells.filter(isSuppressed) : [];

  return (
    <div className="overflow-hidden rounded-xl border border-border-soft bg-card">
      <div className="flex items-center gap-4 border-b border-border-soft px-4 py-2.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-text-muted">
        <span className="flex-1">name</span>
        {cols.map((c) => (
          <span key={c.head} className={cn("w-20 shrink-0", c.align === "left" ? "text-left" : "text-right")}>
            {c.head}
          </span>
        ))}
      </div>
      {ranked.map(row)}
      {folded.length > 0 && (
        <details className="group border-t border-border-soft">
          <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-2.5 text-[13px] text-text-secondary transition-colors hover:bg-card-soft">
            <ChevronRight className="size-3.5 transition-transform group-open:rotate-90" strokeWidth={2} />
            {folded.length} more below {MIN_N} pages — shown, not ranked
          </summary>
          <div className="border-t border-border-soft">{folded.map(row)}</div>
        </details>
      )}
    </div>
  );

  function row(cell: T) {
    {
        const suppressed = cell.confidence === "insufficient" || cell.confidence === "blocked";
        const href = hrefFor?.(cell.key) ?? null;
        const name = (
          <span className={cn("truncate text-sm", suppressed ? "text-text-secondary" : "text-text-primary")}>
            {label(cell.key)}
          </span>
        );
        return (
          <div
            key={cell.key}
            className={cn(
              "flex items-center gap-4 border-b border-border-soft px-4 py-2.5 last:border-b-0",
              suppressed && "bg-card-soft/40",
            )}
          >
            <span className="flex min-w-0 flex-1 items-center gap-2">
              {href ? (
                <Link href={href} className="min-w-0 truncate hover:underline">{name}</Link>
              ) : (
                name
              )}
              <ConfidenceMark c={cell.confidence} n={cell.n} />
            </span>
            {cols.map((c) => (
              <span
                key={c.head}
                className={cn("w-20 shrink-0 text-[13px]", c.align === "left" ? "text-left" : "text-right",
                  suppressed && "opacity-55")}
              >
                {c.render(cell)}
              </span>
            ))}
          </div>
        );
    }
  }
}

/** Direction is what matters on a defect rate, and down is good — so this
 *  never colours by sign alone. */
export function Delta({ now, before }: { now: number | null; before: number | null }) {
  if (now === null || before === null) {
    return <span className="text-text-muted">—</span>;
  }
  const d = Math.round((now - before) * 100) / 100;
  if (d === 0) return <span className="text-text-muted">level</span>;
  return (
    <span className={cn("tabular-nums", d < 0 ? "text-success-strong" : "text-warning-strong")}>
      {d > 0 ? "+" : ""}
      {d}
    </span>
  );
}
