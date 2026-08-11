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
  uptime_pct: number | null;
  incidents_handled: number | null;
  health: "healthy" | "attention" | "unknown" | null;
};

export type LivingCertificate = {
  as_of: string;
  story: Story;
  live_health: unknown | null; // Section 1
  timeline: unknown | null; //   Section 2
  verification: unknown | null; // Section 3
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
