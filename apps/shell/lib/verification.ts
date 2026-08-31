import type { Verification } from "./living-certificate";

// LIVING CERTIFICATE — Section 3's wording, kept pure.
//
// Two jobs, both of which are easy to get subtly wrong on a client-facing page:
//
//  1. Say how many checks hold WITHOUT flattering the result. If a check is
//     failing, the same line says so. Hiding it would make the counter a
//     marketing number instead of a verification one.
//  2. Say when we last looked, in words, WITHOUT inventing precision. `now` is
//     injected so the phrasing is deterministic and testable.

/** "38 of 39 checks holding" — always the full denominator, never just the wins. */
export function holdingLine(v: Verification): string {
  const unit = v.total === 1 ? "check" : "checks";
  return `${v.holding} of ${v.total} ${unit} holding`;
}

/** "1 needs attention", or null when everything holds. */
export function attentionLine(v: Verification): string | null {
  if (v.needs_attention <= 0) return null;
  return `${v.needs_attention} need${v.needs_attention === 1 ? "s" : ""} attention`;
}

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/**
 * "last checked 4 hours ago". Null when we have never checked — an absent
 * timestamp must read as absent, not as "just now".
 *
 * Deliberately coarse: we know when WE fetched, not the instant LinkSpy
 * verified, so minute-level precision would overstate what we know. Section 1
 * replaces this with LinkSpy's authoritative `as_of`.
 */
export function lastCheckedLine(v: Verification, now: Date): string | null {
  if (!v.last_checked_at) return null;
  const then = new Date(v.last_checked_at).getTime();
  if (Number.isNaN(then)) return null;

  const ms = now.getTime() - then;
  if (ms < 0) return "last checked just now"; // clock skew — never say "in 3 hours"
  if (ms < 2 * MIN) return "last checked just now";
  if (ms < HOUR) return `last checked ${Math.floor(ms / MIN)} minutes ago`;
  if (ms < DAY) {
    const h = Math.floor(ms / HOUR);
    return `last checked ${h} hour${h === 1 ? "" : "s"} ago`;
  }
  const d = Math.floor(ms / DAY);
  return `last checked ${d} day${d === 1 ? "" : "s"} ago`;
}

/** The whole line, already joined. Absent parts are simply not present. */
export function verificationClauses(v: Verification, now: Date): string[] {
  return [holdingLine(v), attentionLine(v), lastCheckedLine(v, now)].filter(
    (s): s is string => s !== null,
  );
}
