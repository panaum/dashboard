import Link from "next/link";
import { AlertTriangle, CheckCircle2, ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { Attention } from "@/lib/attention";

/**
 * Overview triage card: the few deliverables that need action right now,
 * most urgent first. Renders a calm "all clear" state when nothing is flagged.
 */
export function AttentionPanel({
  attention,
  limit = 6,
}: {
  attention: Attention;
  limit?: number;
}) {
  const shown = attention.items.slice(0, limit);
  const overflow = attention.total - shown.length;

  return (
    <section className="mb-9">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-text-primary">
          Needs attention
          {attention.total > 0 && (
            <Badge tone="error">{attention.total}</Badge>
          )}
        </h2>
      </div>

      {attention.total === 0 ? (
        <div className="flex items-center gap-3 rounded-xl border border-border-soft bg-card px-5 py-6">
          <span className="flex size-9 items-center justify-center rounded-full bg-success/12 text-success">
            <CheckCircle2 className="size-5" />
          </span>
          <div className="flex flex-col">
            <span className="text-sm font-medium text-text-primary">All clear</span>
            <span className="text-[13px] text-text-secondary">
              Nothing needs attention right now — every deliverable is on track.
            </span>
          </div>
        </div>
      ) : (
        <div className="divide-y divide-border-soft overflow-hidden rounded-xl border border-border-soft bg-card">
          {shown.map((item, i) => (
            <Link
              key={item.id}
              href={item.href}
              style={{ animationDelay: `${i * 40}ms` }}
              className="animate-in group flex items-center gap-3 px-4 py-3 transition-colors hover:bg-card-soft"
            >
              <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-error/10 text-error">
                <AlertTriangle className="size-4" />
              </span>
              <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                <span className="flex items-baseline gap-2">
                  <span className="truncate text-sm font-medium text-text-primary">
                    {item.name}
                  </span>
                  <span className="shrink-0 truncate text-[12px] text-text-muted">
                    {item.clientName}
                  </span>
                </span>
                <span className="flex flex-wrap gap-1.5">
                  {item.reasons.map((r) => (
                    <Badge key={r.kind} tone={r.tone}>
                      {r.label}
                    </Badge>
                  ))}
                </span>
              </div>
              <ChevronRight className="size-4 shrink-0 text-text-muted transition-transform duration-200 group-hover:translate-x-0.5" />
            </Link>
          ))}
          {overflow > 0 && (
            <div className="bg-card-soft/40 px-4 py-2.5 text-center text-[13px] text-text-secondary">
              +{overflow} more deliverable{overflow === 1 ? "" : "s"} need attention
            </div>
          )}
        </div>
      )}
    </section>
  );
}
