// One question, asked in one place: has the reader asked for less motion?
//
// The four transitions on these pages (crossfade, frame resize, highlight
// fade, run progress) are all inline styles, so a CSS media query cannot
// reach them — the components have to ask.

type MatchMedia = (q: string) => { matches: boolean };

export const REDUCE_QUERY = "(prefers-reduced-motion: reduce)";

/** True only when the setting is actually on. No window (SSR) means no claim. */
export function reducedMotion(mm?: MatchMedia | null): boolean {
  const fn = mm ?? (typeof window !== "undefined" ? window.matchMedia?.bind(window) : null);
  if (!fn) return false;
  try {
    return fn(REDUCE_QUERY).matches === true;
  } catch {
    return false;
  }
}

/** A duration in ms, or 0 when motion is reduced. */
export function ms(duration: number, mm?: MatchMedia | null): number {
  return reducedMotion(mm) ? 0 : duration;
}
