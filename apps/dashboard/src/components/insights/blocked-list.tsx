import { Lock } from "lucide-react";

// WHAT THIS PAGE CANNOT TELL YOU, AND WHY.
//
// Every entry is a metric somebody asked for that the data cannot support.
// Rendering them as zeros would have been easy and wrong: a zero reads as
// "none happened" when the truth is "nothing is recorded". Naming them, with
// the column that would unblock each, turns a silent gap into a piece of work.
//
// Deliberately quiet — a sunken panel, no wash, no coloured rail. This is
// missing information, not an alarm, and the only urgent surface on the page
// is in-flight risk.

export type Blocked = { metric: string; because: string; unblockedBy: string };

export function BlockedList({ items, title }: { items: Blocked[]; title: string }) {
  if (items.length === 0) return null;
  return (
    <section className="panel t-in bg-[var(--surface-sunken)] p-5">
      <h2 className="t-card flex items-center gap-2">
        <Lock className="size-3.5 text-[var(--ink-3)]" strokeWidth={2} aria-hidden />
        {title}
      </h2>
      <p className="t-body mt-1 text-[var(--ink-2)]">
        Shown as gaps rather than zeros — a zero would mean it never happened.
      </p>
      <dl className="mt-4 flex flex-col gap-0">
        {items.map((b) => (
          <div key={b.metric} className="rule-row py-3 first:pt-0 last:pb-0">
            <dt className="text-[13px] font-medium text-[var(--ink)]">{b.metric}</dt>
            <dd className="t-body mt-0.5 text-[var(--ink-2)]">
              {b.because}{" "}
              <span className="text-[var(--ink-3)]">Needs: {b.unblockedBy}.</span>
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
