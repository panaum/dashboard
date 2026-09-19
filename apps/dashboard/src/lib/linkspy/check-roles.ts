// Who fixes a finding, and where the fix lives.
//
// This is not derived from the data — the data says "HSTS: missing" and stops.
// It is a statement about how a team divides work, agreed with the operator on
// 2026-09-19, and it is kept in its own module for one reason: different
// clients have different arrangements. Some have their own developer; some
// have a CMS where a content person really can set a meta description. When
// that becomes per-client, it becomes a table in data and `roleOf` grows a
// lookup — no call site changes, because none of them reach into the map.

export type Owner = "client" | "developer" | "content";

/**
 * Where the fix lives.
 *
 * `page` means the fault is in the page's own markup or copy. It does NOT
 * mean we know where on the page — no sentinel check records a selector or a
 * box (#170), so the label must not claim a location it cannot point to.
 */
export type Surface = "page" | "infrastructure";

export type CheckRole = { owner: Owner; surface: Surface };

/** What the reader sees. Lower case: it sits mid-sentence beside the remedy. */
export const OWNER_LABEL: Record<Owner, string> = {
  client: "client",
  developer: "developer",
  content: "content",
};

export const SURFACE_LABEL: Record<Surface, string> = {
  page: "In the page's markup",
  infrastructure: "In DNS, headers and root files",
};

/**
 * The agreed arrangement, by check key.
 *
 * Six of these were genuinely arguable and were decided rather than derived:
 * meta description, title and Open Graph went to content because they are
 * words somebody chooses; h1 and heading levels went to development because
 * whether a page has one h1 and whether its levels step correctly is
 * structural. Alt text went to development too, against the instinct that
 * describing an image is writing — it is missing because the component does
 * not pass the attribute through, and a copywriter handed "add alt text" has
 * nowhere to put it.
 */
export const DEFAULT_ROLES: Record<string, CheckRole> = {
  // ── The client's DNS. We cannot publish these records for them. ──────────
  spf: { owner: "client", surface: "infrastructure" },
  dmarc: { owner: "client", surface: "infrastructure" },
  dkim: { owner: "client", surface: "infrastructure" },
  mx: { owner: "client", surface: "infrastructure" },

  // ── Response headers and server config. ─────────────────────────────────
  hsts: { owner: "developer", surface: "infrastructure" },
  csp: { owner: "developer", surface: "infrastructure" },
  xcto: { owner: "developer", surface: "infrastructure" },
  frame: { owner: "developer", surface: "infrastructure" },
  referrer: { owner: "developer", surface: "infrastructure" },
  https: { owner: "developer", surface: "infrastructure" },

  // ── Files at the domain root. ───────────────────────────────────────────
  robots: { owner: "developer", surface: "infrastructure" },
  sitemap: { owner: "developer", surface: "infrastructure" },

  // ── The page's own markup. ──────────────────────────────────────────────
  labels: { owner: "developer", surface: "page" },
  names: { owner: "developer", surface: "page" },
  ids: { owner: "developer", surface: "page" },
  lang: { owner: "developer", surface: "page" },
  canonical: { owner: "developer", surface: "page" },
  mixed: { owner: "developer", surface: "page" },
  noindex: { owner: "developer", surface: "page" },
  alt: { owner: "developer", surface: "page" },
  h1: { owner: "developer", surface: "page" },
  headings: { owner: "developer", surface: "page" },

  // ── Words somebody chooses. ─────────────────────────────────────────────
  description: { owner: "content", surface: "page" },
  title: { owner: "content", surface: "page" },
  og: { owner: "content", surface: "page" },

  // The guards' placeholder when the homepage could not be read at all. It
  // carries status "unknown", so it never reaches the findings list — mapped
  // so the completeness test can assert every key the backend emits is known.
  page: { owner: "developer", surface: "page" },
};

/**
 * The role for a check.
 *
 * `overrides` is the seam for per-client arrangements. Nothing passes it yet;
 * when a client table arrives it is read here and every caller is unchanged.
 */
export function roleOf(
  checkKey: string | null | undefined,
  overrides?: Partial<Record<string, Partial<CheckRole>>>,
): CheckRole | null {
  const key = (checkKey ?? "").trim();
  if (!key) return null;
  const base = DEFAULT_ROLES[key];
  const over = overrides?.[key];
  if (!base && !over) return null;
  return {
    owner: over?.owner ?? base?.owner ?? "developer",
    surface: over?.surface ?? base?.surface ?? "page",
  };
}
