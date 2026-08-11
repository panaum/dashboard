// LIVING CERTIFICATE — the shell's one call.
//
// The shell holds NO service keys (this repo is public). Everything is composed
// by the Dashboard, which owns the share token and the LinkSpy keys; this module
// fetches that one payload and nothing else.
//
// ⚠ CONTRACT LIVES IN TWO REPOS. These types mirror the Dashboard's response
// (src/app/api/living-certificate/[shareId]/route.ts). They are duplicated
// because the repos share no package — Next 14/React 18 here, Next 16/React 19
// there. Keep the shape ADDITIVE: new sections arrive as new keys, existing keys
// never change meaning, so an older shell keeps rendering against a newer
// Dashboard.

/** Section 4 — the story mode header. */
export type Story = {
  page_name: string;
  client_name: string;
  /** "YYYY-MM-DD" (UTC) or null when QA has not signed off yet. */
  delivered_on: string | null;
  days_since_delivery: number | null;
  // Filled by Section 1. null means "no data" and the clause is omitted —
  // never render null as 0.
  //
  // ⚠ PER-SITE, NOT PER-CLIENT (F11). These describe the site this page is
  // published on. The names carry the scope so no future reader of this contract
  // can mistake them for the client's estate or for the page alone.
  site_uptime_pct: number | null;
  site_incidents_handled: number | null;
  site_health: "healthy" | "attention" | "unknown" | null;
};

/** Section 1 — one chip per check. Derived states only; never LinkSpy's text. */
export type ChipState = "healthy" | "attention" | "critical" | "unknown";

export type Chip = {
  key: "ssl" | "uptime" | "forms" | "tracking" | "links";
  label: string;
  state: ChipState;
  /** The Dashboard's wording, derived from the state. */
  note: string;
};

export type LiveHealth = {
  chips: Chip[];
  as_of: string | null;
  /** Served from last-known-good because LinkSpy was unreachable. */
  stale: boolean;
};

/**
 * Section 3 — the continuous verification counters.
 *
 * The whole object is null when nothing has been graded. That is not "no data
 * yet"; it is "there is no honest counter to show", because an ungraded
 * checklist would otherwise render as "0 checks holding". Never substitute
 * zeroes for a null Verification.
 */
export type Verification = {
  total: number;
  holding: number;
  needs_attention: number;
  /** When the Dashboard last checked. Null when it never has. */
  last_checked_at: string | null;
};

export type LivingCertificate = {
  as_of: string;
  story: Story;
  verification: Verification | null; // Section 3
  live_health: LiveHealth | null; //     Section 1
  timeline: unknown | null; //           Section 2
};

/** `gone` = revoked, not enabled, or the flag is off — all answer 404 alike. */
export type FetchResult =
  | { kind: "ok"; data: LivingCertificate }
  | { kind: "gone" }
  | { kind: "unavailable" };

const TIMEOUT_MS = 6000;
const REVALIDATE_S = 60;

export async function fetchLivingCertificate(shareId: string): Promise<FetchResult> {
  const base = (process.env.DASHBOARD_URL || "").replace(/\/$/, "");
  if (!base) return { kind: "unavailable" };

  try {
    const res = await fetch(
      `${base}/api/living-certificate/${encodeURIComponent(shareId)}`,
      { signal: AbortSignal.timeout(TIMEOUT_MS), next: { revalidate: REVALIDATE_S } },
    );
    // A deliberate 404 is an answer, not a failure: the link is revoked, the
    // page never opted in, or the feature is off. All three look the same.
    if (res.status === 404) return { kind: "gone" };
    if (!res.ok) return { kind: "unavailable" };
    return { kind: "ok", data: (await res.json()) as LivingCertificate };
  } catch {
    // Timeout or network error. Staleness over errors: the caller shows a quiet
    // "temporarily unavailable" rather than an error page.
    return { kind: "unavailable" };
  }
}
