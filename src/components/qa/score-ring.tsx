import type { QualityScore } from "@/lib/quality-score";

const TONE_STROKE: Record<string, string> = {
  success: "var(--color-success)",
  warning: "var(--color-warning)",
  error: "var(--color-error)",
  neutral: "var(--color-text-muted)",
};

/**
 * Static SVG quality-score gauge — pure markup, no client JS, so it renders in
 * Server Components (portal, badge, print). For the animated editor gauge see
 * qa/qa-ring.tsx.
 */
export function ScoreRing({
  score,
  size = 96,
  stroke = 8,
}: {
  score: QualityScore;
  size?: number;
  stroke?: number;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = score.provisional ? 0 : score.score / 100;
  const dash = c * pct;
  const color = TONE_STROKE[score.tone] ?? TONE_STROKE.neutral;

  return (
    <div
      className="relative inline-flex items-center justify-center"
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--color-border-soft)"
          strokeWidth={stroke}
        />
        {!score.provisional && (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={color}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={`${dash} ${c}`}
          />
        )}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        {score.provisional ? (
          <span className="text-[11px] font-medium text-text-muted">In review</span>
        ) : (
          <>
            <span
              className="font-semibold tabular-nums text-text-primary"
              style={{ fontSize: size * 0.3 }}
            >
              {score.score}
            </span>
            <span className="text-[10px] font-medium uppercase tracking-[0.08em] text-text-muted">
              Score
            </span>
          </>
        )}
      </div>
    </div>
  );
}
