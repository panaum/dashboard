// LIVING CERTIFICATE — Section 4, the story mode header.
//
//   "Fautons Homepage · 187 days since delivery · 99.8% uptime
//    · 3 incidents handled · currently healthy"
//
// Pure: no I/O, no React, no secrets, no clock read. `now` is injected, so every
// case is deterministic and testable — the same discipline as src/lib/insights.ts
// (CLAUDE.md: keep aggregation pure and outside Server Components).
//
// ═══ SECTIONS NOT YET BUILT ═══
// uptime_pct / incidents_handled / health come from LinkSpy and land with
// Section 1. They are declared NOW, as nulls, so that wiring them up is an
// additive fill-in and never a response-shape change (T8). A renderer must treat
// null as "omit this clause", never as zero.

/** What the Dashboard's own database can answer about a page. */
export type StorySource = {
  pageName: string;
  clientName: string;
  /** QACertificate.completedAt — sign-off. Null until QA completes. */
  signedOffAt: Date | null;
};

/** Section 1 fills these in. Shape is fixed now so it never has to change. */
export type LiveVitals = {
  uptimePct: number | null;
  incidentsHandled: number | null;
  health: StoryHealth | null;
};

export type StoryHealth = "healthy" | "attention" | "unknown";

/** The wire shape. snake_case, matching the other bridge routes. */
export type Story = {
  page_name: string;
  client_name: string;
  /** UTC calendar date of sign-off, "YYYY-MM-DD". Null until signed off. */
  delivered_on: string | null;
  /** Whole UTC days since sign-off. Null until signed off. */
  days_since_delivery: number | null;
  uptime_pct: number | null;
  incidents_handled: number | null;
  health: StoryHealth | null;
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** UTC midnight of a date, so day counting never depends on the server's zone. */
function utcMidnight(d: Date): number {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/**
 * Whole UTC days between two instants, counted on calendar days rather than
 * elapsed hours — "delivered yesterday evening" reads as 1 day, not 0.
 *
 * Clamped at 0: a sign-off timestamped in the future is bad data, and "-3 days
 * since delivery" on a client's certificate is worse than "0".
 */
export function daysSince(from: Date, now: Date): number {
  const diff = utcMidnight(now) - utcMidnight(from);
  return Math.max(0, Math.round(diff / DAY_MS));
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function isUsableDate(d: Date | null | undefined): d is Date {
  return d instanceof Date && !Number.isNaN(d.getTime());
}

/** Compose the header. Missing vitals stay null — the renderer omits them. */
export function buildStory(
  src: StorySource,
  now: Date,
  vitals: LiveVitals = { uptimePct: null, incidentsHandled: null, health: null },
): Story {
  const signed = isUsableDate(src.signedOffAt) ? src.signedOffAt : null;
  return {
    page_name: src.pageName,
    client_name: src.clientName,
    delivered_on: signed ? isoDate(signed) : null,
    days_since_delivery: signed ? daysSince(signed, now) : null,
    uptime_pct: vitals.uptimePct,
    incidents_handled: vitals.incidentsHandled,
    health: vitals.health,
  };
}
