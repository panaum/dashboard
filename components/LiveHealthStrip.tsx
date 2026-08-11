import type { LiveHealth, ChipState } from "@/lib/living-certificate";

// LIVING CERTIFICATE — Section 1, the live health strip.
//
//   LIVE HEALTH
//   ┌────────┬────────┬────────┬──────────┬────────┐
//   │  SSL   │ Uptime │ Forms  │ Tracking │ Links  │
//   │   ●    │   ●    │   ●    │    ●     │   ●    │
//   │ Valid  │Reachabl│Not chk │ Not chk  │Broken  │
//   └────────┴────────┴────────┴──────────┴────────┘
//
// Presentational only. Every state and every word arrives already derived from
// the Dashboard — this file chooses colour and layout and nothing else. Section 1
// carries no LinkSpy text by design (F10), so there is nothing here to sanitise.
//
// ═══ UNKNOWN IS NEVER GREEN ═══
// The discipline held since Sections 3 and 4: absence is not success. A chip we
// could not check renders neutral grey with "Not checked" — never a tick, never
// an implied pass. The one thing a client must never take from this strip is
// reassurance we did not earn.

const STATE: Record<ChipState, { dot: string; note: string; ring: string }> = {
  healthy: { dot: "bg-lc-success", note: "text-lc-secondary", ring: "border-lc-line" },
  attention: { dot: "bg-lc-warning", note: "text-lc-warning", ring: "border-lc-warning/35" },
  critical: { dot: "bg-lc-error", note: "text-lc-error", ring: "border-lc-error/40" },
  // Deliberately the quietest treatment on the strip. Grey reads as "no claim",
  // which is exactly what it is.
  unknown: { dot: "bg-lc-muted/50", note: "text-lc-muted", ring: "border-lc-line" },
};

function checkedAgo(iso: string | null, now: Date): string | null {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return null;
  const ms = now.getTime() - then;
  if (ms < 0 || ms < 2 * 60_000) return "checked just now";
  if (ms < 3_600_000) return `checked ${Math.floor(ms / 60_000)} minutes ago`;
  if (ms < 86_400_000) {
    const h = Math.floor(ms / 3_600_000);
    return `checked ${h} hour${h === 1 ? "" : "s"} ago`;
  }
  const d = Math.floor(ms / 86_400_000);
  return `checked ${d} day${d === 1 ? "" : "s"} ago`;
}

export function LiveHealthStrip({
  health,
  now,
}: {
  health: LiveHealth;
  now: Date;
}) {
  const ago = checkedAgo(health.as_of, now);

  return (
    <section className="rounded-2xl border border-lc-line bg-lc-card p-6 shadow-lc sm:p-8">
      <h2 className="text-[11px] font-semibold uppercase tracking-[0.07em] text-lc-muted">
        Live health
      </h2>

      <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
        {health.chips.map((chip) => {
          const s = STATE[chip.state];
          return (
            <li
              key={chip.key}
              className={`flex flex-col gap-1.5 rounded-xl border ${s.ring} bg-lc-card-soft px-3 py-3`}
            >
              <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-lc-muted">
                <span className={`size-1.5 shrink-0 rounded-full ${s.dot}`} aria-hidden />
                {chip.label}
              </span>
              <span className={`text-[13px] font-medium ${s.note}`}>{chip.note}</span>
            </li>
          );
        })}
      </ul>

      {/* The scope sentence lives in StoryHeader and is NOT repeated here:
          `site_health` is derived from these same chips, so whenever this strip
          renders the header has already stated the scope directly above it.
          Saying it twice reads as a disclaimer rather than a fact. */}
      {(ago || health.stale) && (
        <p className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-lc-muted">
          {ago && <span>{ago}</span>}
          {/* Staleness is disclosed, never hidden — a green chip served from an
              unreachable LinkSpy has to say so. */}
          {health.stale && (
            <span className="text-lc-warning">{ago ? "· " : ""}awaiting a fresh check</span>
          )}
        </p>
      )}
    </section>
  );
}
