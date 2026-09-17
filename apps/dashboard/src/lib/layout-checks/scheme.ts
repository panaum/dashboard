// WHICH COLOUR SCHEME A RUN WAS CAPTURED IN.
//
// The preview service can render a page with prefers-color-scheme: dark, and
// a page that has a dark stylesheet is a different page there — different
// contrast, different images, sometimes different bugs. A dark run is its own
// run: every device in it was asked for dark, its images are stored under a
// different name on the service, and it is compared with the last dark run,
// not the last light one. This is the one place that reads which it was.

export type Scheme = "light" | "dark";

type ReportLike = { devices?: { color_scheme?: string | null }[] | null } | null | undefined;

/** The scheme the run was captured in. A run is one scheme throughout; an
 *  older report that does not say is light, which is all there was then. */
export function runScheme(report: ReportLike): Scheme {
  const first = report?.devices?.[0]?.color_scheme;
  return first === "dark" ? "dark" : "light";
}

/** "dark mode" for a caption or a history row; nothing for light, which is
 *  the default and does not need saying. */
export function schemeWords(scheme: Scheme): string | null {
  return scheme === "dark" ? "dark mode" : null;
}
