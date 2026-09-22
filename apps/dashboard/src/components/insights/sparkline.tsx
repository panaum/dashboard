// A row's last few months, at the size of a word.
//
// Two rules keep it honest at 20px tall:
//
//  · A month with no delivery is a GAP, not a zero and not a straight line
//    joining over it. Drawing through it would invent a trend through months
//    that never happened, which at this size nobody would ever catch.
//  · Every sparkline in a column shares ONE y-scale, passed in by the table.
//    Auto-scaling each row to its own max is the classic sparkline lie: two
//    lines look identical while one is ten times the other.
//
// The last point is emphasised because it is the only one a reader can date
// without a label — it is "now".
//
// And below MIN_MONTHS real values there is no line to draw. Most clients
// deliver in one or two months of a nine-month window, and rendering those as
// a sparkline produced a column of isolated specks that looked like data and
// carried none. Those rows get a dash: no trend exists, so none is drawn.

/** Fewer real months than this and there is no trend, only points. */
const MIN_MONTHS = 3;

export function Sparkline({
  values,
  max,
  tone = "neutral",
  label,
}: {
  values: (number | null)[];
  /** Shared across the whole column, never per row. */
  max: number;
  tone?: "neutral" | "good" | "poor";
  label?: string;
}) {
  const W = 68;
  const H = 20;
  const PAD = 2;
  const points = values.map((v, i) => ({
    x: values.length === 1 ? W / 2 : PAD + (i * (W - PAD * 2)) / (values.length - 1),
    y: v === null ? null : H - PAD - (Math.min(v, max) / (max || 1)) * (H - PAD * 2),
    v,
  }));

  // Split into runs of consecutive real values; each run is its own polyline,
  // so a gap stays a gap.
  const runs: { x: number; y: number }[][] = [];
  let run: { x: number; y: number }[] = [];
  for (const p of points) {
    if (p.y === null) {
      if (run.length) runs.push(run);
      run = [];
    } else {
      run.push({ x: p.x, y: p.y });
    }
  }
  if (run.length) runs.push(run);

  const stroke =
    tone === "poor" ? "var(--poor)" : tone === "good" ? "var(--good)" : "var(--ink-3)";
  const last = [...points].reverse().find((p) => p.y !== null);

  if (values.filter((v) => v !== null).length < MIN_MONTHS) {
    return (
      <span
        title={`Delivered in ${values.filter((v) => v !== null).length} of ${values.length} months — too few for a trend`}
        className="fig text-[var(--ink-3)]"
      >
        —
      </span>
    );
  }

  return (
    <svg
      width={W}
      height={H}
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={label ?? "trend"}
      className="overflow-visible"
    >
      {runs.map((r, i) =>
        r.length === 1 ? (
          <circle key={i} cx={r[0].x} cy={r[0].y} r={1.6} fill={stroke} />
        ) : (
          <polyline
            key={i}
            points={r.map((p) => `${p.x},${p.y}`).join(" ")}
            fill="none"
            stroke={stroke}
            strokeWidth={1.25}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ),
      )}
      {last && <circle cx={last.x} cy={last.y!} r={2} fill={stroke} />}
    </svg>
  );
}
