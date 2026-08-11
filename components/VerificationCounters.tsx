import type { Verification } from "@/lib/living-certificate";
import { holdingLine, attentionLine, lastCheckedLine } from "@/lib/verification";

// LIVING CERTIFICATE — Section 3, the continuous verification counters.
//
//   38 of 39 checks holding
//   1 needs attention · last checked 7 days ago
//
// Presentational only; the wording rules live in lib/verification.ts. The
// caller renders this section only when `verification` is non-null — an
// ungraded checklist has no honest counter and shows nothing at all.

export function VerificationCounters({
  verification,
  now,
}: {
  verification: Verification;
  now: Date;
}) {
  const v = verification;
  const attention = attentionLine(v);
  const checked = lastCheckedLine(v, now);
  const allHolding = v.needs_attention === 0;

  return (
    <section className="rounded-2xl border border-lc-line bg-lc-card p-6 shadow-lc sm:p-8">
      <h2 className="text-[11px] font-semibold uppercase tracking-[0.07em] text-lc-muted">
        Continuous verification
      </h2>

      <p className="tabular mt-3 flex items-baseline gap-2 text-lc-text">
        <span className="text-3xl font-semibold tracking-tight">{v.holding}</span>
        <span className="text-sm text-lc-secondary">
          of {v.total} {v.total === 1 ? "check" : "checks"} holding
        </span>
      </p>

      {/* Progress is encoded in form as well as number, so the ratio reads at a
          glance without having to divide two figures. */}
      <div
        className="mt-4 h-1.5 w-full overflow-hidden rounded-full bg-lc-card-soft"
        role="img"
        aria-label={holdingLine(v)}
      >
        <div
          className={`h-full rounded-full ${allHolding ? "bg-lc-success" : "bg-lc-accent"}`}
          style={{ width: `${v.total > 0 ? (v.holding / v.total) * 100 : 0}%` }}
        />
      </div>

      <p className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-lc-secondary">
        {attention && (
          <span className="inline-flex items-center gap-1.5 font-medium text-lc-warning">
            <span className="size-1.5 rounded-full bg-lc-warning" aria-hidden />
            {attention}
          </span>
        )}
        {attention && checked && <span className="text-lc-muted">·</span>}
        {checked && <span className="text-lc-muted">{checked}</span>}
      </p>
    </section>
  );
}
