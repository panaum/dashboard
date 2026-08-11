import type { Story } from "@/lib/living-certificate";
import { storyClauses } from "@/lib/story-clauses";

// LIVING CERTIFICATE — Section 4, the story mode header.
//
//   Fautons Homepage
//   187 days since delivery · 99.8% uptime · 3 incidents handled
//   ● Currently healthy
//
// Presentational only. The null-omission rule lives in lib/story-clauses.ts so
// it can be tested without a renderer; this file only arranges the result.

const HEALTH: Record<
  NonNullable<Story["health"]>,
  { dot: string; text: string; label: string }
> = {
  healthy: { dot: "bg-teal", text: "text-teal", label: "Currently healthy" },
  attention: { dot: "bg-amber-400", text: "text-amber-400", label: "Needs attention" },
  unknown: { dot: "bg-text-muted", text: "text-text-muted", label: "Status unknown" },
};

export function StoryHeader({ story }: { story: Story }) {
  const clauses = storyClauses(story);
  const health = story.health ? HEALTH[story.health] : null;

  return (
    <header className="rounded-2xl border border-line bg-ink-850 p-6 shadow-door sm:p-8">
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-text-muted">
        {story.client_name}
      </p>

      <h1 className="mt-2 font-display text-2xl font-bold tracking-tight text-text-primary sm:text-3xl">
        {story.page_name}
      </h1>

      {clauses.length > 0 && (
        <p className="tabular mt-3 text-sm leading-relaxed text-text-secondary">
          {clauses.join(" · ")}
        </p>
      )}

      {health && (
        <p className={`mt-4 inline-flex items-center gap-2 text-sm font-medium ${health.text}`}>
          <span className={`size-2 rounded-full ${health.dot}`} aria-hidden />
          {health.label}
        </p>
      )}
    </header>
  );
}
