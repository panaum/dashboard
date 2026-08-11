import type { Story } from "@/lib/living-certificate";
import { storyClauses } from "@/lib/story-clauses";

// LIVING CERTIFICATE — Section 4, the story mode header.
//
//   FAUTONS
//   Fautons LP
//   14 days since delivery · 99.8% uptime · 3 incidents handled
//   ● Currently healthy
//
// Presentational only. The null-omission rule lives in lib/story-clauses.ts so
// it can be tested without a renderer; this file only arranges the result.
//
// Palette is the Dashboard's, ported as `lc-*` (see tailwind.config.ts), so this
// reads as a sibling of /c/{shareId} rather than as a different product.

const HEALTH: Record<
  NonNullable<Story["health"]>,
  { dot: string; text: string; label: string }
> = {
  healthy: { dot: "bg-lc-success", text: "text-lc-success", label: "Currently healthy" },
  attention: { dot: "bg-lc-warning", text: "text-lc-warning", label: "Needs attention" },
  unknown: { dot: "bg-lc-muted", text: "text-lc-muted", label: "Status unknown" },
};

export function StoryHeader({ story }: { story: Story }) {
  const clauses = storyClauses(story);
  const health = story.health ? HEALTH[story.health] : null;

  return (
    <header className="rounded-2xl border border-lc-line bg-lc-card p-6 shadow-lc sm:p-8">
      <p className="text-[11px] font-semibold uppercase tracking-[0.07em] text-lc-muted">
        {story.client_name}
      </p>

      <h1 className="mt-2 text-2xl font-semibold tracking-tight text-lc-text sm:text-3xl">
        {story.page_name}
      </h1>

      {clauses.length > 0 && (
        <p className="tabular mt-3 text-sm leading-relaxed text-lc-secondary">
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
