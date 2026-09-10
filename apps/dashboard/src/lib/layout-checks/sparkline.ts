// The run trend beside the verdict: errors per run, oldest to newest, as a
// small line. Geometry only; the component draws it.

export type TrendPoint = { checkedAt: string; errors: number };

export type Spark = {
  /** SVG polyline points, oldest first. */
  points: string;
  /** Each point's position, for dots and labels. */
  dots: { x: number; y: number; value: number }[];
};

/** Fit `values` (oldest first) into a `w`×`h` box with `pad` px kept clear
 *  at the top and bottom. A flat run draws flat, mid-height. */
export function spark(values: number[], w: number, h: number, pad = 6): Spark {
  if (values.length === 0) return { points: "", dots: [] };
  const max = Math.max(...values), min = Math.min(...values);
  const span = max - min;
  const dx = values.length > 1 ? w / (values.length - 1) : 0;
  const dots = values.map((v, i) => ({
    x: Math.round(values.length > 1 ? i * dx : w / 2),
    y: Math.round(span === 0 ? h / 2 : pad + (1 - (v - min) / span) * (h - 2 * pad)),
    value: v,
  }));
  return { points: dots.map((d) => `${d.x},${d.y}`).join(" "), dots };
}

/** Oldest-first values from newest-first runs, capped to the last `n`. */
export function trendValues(points: TrendPoint[], n = 8): number[] {
  return points.slice(0, n).map((p) => p.errors).reverse();
}
