import { Lock } from "lucide-react";

// WHAT THIS PAGE CANNOT TELL YOU, AND WHY.
//
// Every entry here is a metric somebody asked for that the data cannot
// support. Rendering them as zeros would have been easy and wrong — a zero
// reads as "none happened", and what is true is "nothing is recorded". Naming
// them, with the field that would unblock each, turns a silent gap into a
// piece of work somebody can pick up.

export type Blocked = { metric: string; because: string; unblockedBy: string };

export function BlockedList({ items, title }: { items: Blocked[]; title: string }) {
  if (items.length === 0) return null;
  return (
    <section className="rounded-xl border border-border-soft bg-card-soft/50 p-5">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-text-primary">
        <Lock className="size-3.5 text-text-muted" strokeWidth={2} />
        {title}
      </h2>
      <p className="mt-1 text-[13px] text-text-secondary">
        Not shown as zero, because zero would mean it never happened. Nothing is recorded.
      </p>
      <dl className="mt-4 flex flex-col gap-3">
        {items.map((b) => (
          <div key={b.metric} className="border-t border-border-soft pt-3 first:border-t-0 first:pt-0">
            <dt className="text-[13px] font-medium text-text-primary">{b.metric}</dt>
            <dd className="mt-0.5 text-[13px] text-text-secondary">
              {b.because}{" "}
              <span className="text-text-muted">Needs: {b.unblockedBy}.</span>
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
