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

/**
 * Section 1 fills these in.
 *
 * ⚠ PER-SITE, NOT PER-CLIENT (F11). These describe the site this page is
 * published on — never the client's other properties. A page-level share token
 * must not reveal a client's estate, so the field names carry the scope and the
 * copy states it.
 */
export type LiveVitals = {
  siteUptimePct: number | null;
  siteIncidentsHandled: number | null;
  siteHealth: StoryHealth | null;
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
  /** Uptime of THIS PAGE'S SITE. Null when unavailable — never 0. */
  site_uptime_pct: number | null;
  /** Incidents handled on THIS PAGE'S SITE. */
  site_incidents_handled: number | null;
  site_health: StoryHealth | null;
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
  vitals: LiveVitals = { siteUptimePct: null, siteIncidentsHandled: null, siteHealth: null },
): Story {
  const signed = isUsableDate(src.signedOffAt) ? src.signedOffAt : null;
  return {
    page_name: src.pageName,
    client_name: src.clientName,
    delivered_on: signed ? isoDate(signed) : null,
    days_since_delivery: signed ? daysSince(signed, now) : null,
    site_uptime_pct: vitals.siteUptimePct,
    site_incidents_handled: vitals.siteIncidentsHandled,
    site_health: vitals.siteHealth,
  };
}
