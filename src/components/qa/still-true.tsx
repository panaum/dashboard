// "Still True Today" — presentational only (no hooks, no secrets), so it renders
// in both the server page and the client checklist. All data is pre-derived on
// the server from LinkSpy's status; this file only formats it.
import { ShieldCheck, TriangleAlert, Check, CircleHelp, ExternalLink } from "lucide-react";
import type { Annotations, LiveStatus } from "@/lib/linkspy/catalog-map";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Deterministic UTC formatting — identical on server and client (no hydration
// mismatch, no local-timezone drift).
export function fmtUtc(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getUTCDate())} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${p(d.getUTCHours())}:${p(d.getUTCMinutes())} UTC`;
}

function daysRemaining(detail: string): number | null {
  const m = detail.match(/(\d+)\s+days?\s+remaining/i);
  return m ? Number(m[1]) : null;
}

// One live-status line beneath a checklist item's delivery verdict.
export function LiveLine({
  status,
  delivered,
  incidentHref,
}: {
  status: LiveStatus;
  delivered: boolean;
  incidentHref?: string | null;
}) {
  const prefix = delivered ? "Passed at delivery · " : "";
  if (status.verdict === "failing") {
    return (
      <div className="mt-1 flex items-center gap-1.5 text-xs text-error">
        <TriangleAlert className="size-3.5 shrink-0" />
        <span>
          <span className="text-text-muted">{prefix}</span>
          <span className="font-semibold">NOW FAILING</span> — {status.detail}
        </span>
        {status.incidentRef && incidentHref && (
          <a href={incidentHref} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 underline underline-offset-2">
            incident <ExternalLink className="size-3" />
          </a>
        )}
      </div>
    );
  }
  if (status.verdict === "couldnt_verify") {
    return (
      <div className="mt-1 flex items-center gap-1.5 text-xs text-text-muted">
        <CircleHelp className="size-3.5 shrink-0" />
        <span>{prefix}couldn&apos;t re-verify — {status.detail}</span>
      </div>
    );
  }
  return (
    <div className="mt-1 flex items-center gap-1.5 text-xs text-text-secondary">
      <Check className="size-3.5 shrink-0 text-success" />
      <span>
        <span className="text-text-muted">{prefix}</span>still holding — {status.detail}
      </span>
    </div>
  );
}

// The module header above the checklist: one verdict-first summary strip.
export function StillTrueHeader({
  annotations,
  asOf,
  stale,
  totalItems,
  linkspyHref,
}: {
  annotations: Annotations;
  asOf: string;
  stale: boolean;
  totalItems: number;
  linkspyHref?: string | null;
}) {
  const { summary, pageLevel, watchedItemCount } = annotations;
  const allHolding = summary.failing === 0 && summary.couldnt_verify === 0;
  const anyFailing = summary.failing > 0;

  // For the all-holding hero, surface the longest countdown we can see.
  const allStatuses = [...Object.values(annotations.byItemName), ...pageLevel];
  const maxDays = allStatuses
    .filter((s) => s.verdict === "holding")
    .map((s) => daysRemaining(s.detail))
    .filter((n): n is number => n !== null)
    .reduce<number | null>((a, b) => (a === null ? b : Math.max(a, b)), null);

  return (
    <div
      className={`rounded-xl border p-4 ${
        anyFailing ? "border-error/30 bg-error/5" : "border-border-soft bg-card"
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2.5">
          {anyFailing ? (
            <TriangleAlert className="size-5 shrink-0 text-error" />
          ) : (
            <ShieldCheck className="size-5 shrink-0 text-success" />
          )}
          <div>
            <div className="text-sm font-semibold text-text-primary">
              {allHolding
                ? `${watchedItemCount + pageLevel.length} checks under watch — all holding${maxDays !== null ? ` · ${maxDays} days` : ""}`
                : anyFailing
                  ? `${summary.failing} of ${watchedItemCount + pageLevel.length} continuous checks need attention`
                  : `${watchedItemCount + pageLevel.length} checks under watch`}
            </div>
            <div className="text-xs text-text-secondary">
              {watchedItemCount} of {totalItems} delivery checks under continuous verification ·{" "}
              {summary.holding} holding · {summary.failing} need attention
              {summary.couldnt_verify > 0 && ` · ${summary.couldnt_verify} unverifiable`}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-text-muted">
            {stale ? "last verified " : "as of "}
            {fmtUtc(asOf)}
          </span>
          {linkspyHref && (
            <a
              href={linkspyHref}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-xs text-text-secondary underline underline-offset-2"
            >
              View in LinkSpy <ExternalLink className="size-3" />
            </a>
          )}
        </div>
      </div>

      {/* Page-level checks (uptime / domain) — no checklist row of their own. */}
      {pageLevel.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 border-t border-border-soft pt-3">
          {pageLevel.map((s) => (
            <span
              key={s.key}
              className={`inline-flex items-center gap-1.5 text-xs ${
                s.verdict === "failing"
                  ? "text-error"
                  : s.verdict === "couldnt_verify"
                    ? "text-text-muted"
                    : "text-text-secondary"
              }`}
            >
              {s.verdict === "failing" ? (
                <TriangleAlert className="size-3.5" />
              ) : s.verdict === "couldnt_verify" ? (
                <CircleHelp className="size-3.5" />
              ) : (
                <Check className="size-3.5 text-success" />
              )}
              {s.detail}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// The one quiet affordance shown on an UNMAPPED page — a single line, no nag.
export function LinkToMonitoring({
  pageRef,
  linkspyHref,
}: {
  pageRef: string;
  linkspyHref?: string | null;
}) {
  const inner = (
    <span className="inline-flex items-center gap-1.5 text-xs text-text-muted hover:text-text-secondary">
      <ShieldCheck className="size-3.5" />
      Link to continuous monitoring
      <ExternalLink className="size-3" />
    </span>
  );
  return (
    <div title={`In LinkSpy: open this site → Settings → QA Dashboard link, and paste this page reference:\n${pageRef}`}>
      {linkspyHref ? (
        <a href={linkspyHref} target="_blank" rel="noreferrer">
          {inner}
        </a>
      ) : (
        inner
      )}
    </div>
  );
}
