// LIVING CERTIFICATE — the kill switch.
//
// Off (unset, or anything other than "1") the whole feature is inert: the
// composing endpoint answers 404, `Page.livingCertificateEnabled` is never read,
// and every existing view is byte-identical. Invariant 2.
//
// Injectable env so the flag is testable without mutating process.env — the same
// shape as presenceChipsEnabled() in src/lib/linkspy/client-presence-chips-shape.ts.
export function livingCertificateFlagOn(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return env.LIVING_CERTIFICATE === "1";
}
