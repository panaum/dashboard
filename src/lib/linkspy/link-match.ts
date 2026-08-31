// Pure matching between Dashboard pages and LinkSpy sites. No I/O, no clock, no
// secrets — so the whole proposal set is unit-testable without either system.
//
// WHY: every LinkSpy feature in this app is gated on Page.registrySiteId, and
// that column is set on 1 of 277 pages. Linking is currently a manual per-page
// operator action, so the bridge is live and idle. This module decides which
// pages COULD be linked; nothing here writes, and nothing here auto-applies —
// a wrong link silently annotates a checklist with another site's verdicts,
// which is worse than no link at all.

export type PageRow = {
  id: string;
  name: string;
  url: string | null;
  clientName: string;
  registrySiteId: string | null;
};

export type SiteRow = {
  id: string;
  url: string | null;
  name?: string | null;
  /** LinkSpy only exposes a site through the registry once it has a client. */
  hasClient?: boolean;
  /** An unmonitored site produces no verdicts — linking it yields silence. */
  monitored?: boolean;
};

/**
 * Hostname, lowercased, `www.` stripped, port dropped. Path and query are
 * deliberately discarded: LinkSpy registers a site per URL (including
 * `?source=` and `?preview=1` variants), so path-sensitive comparison would
 * split one host into several non-matching entries.
 */
export function hostOf(raw: string | null | undefined): string | null {
  const s = (raw ?? "").trim();
  if (!s) return null;
  let u: URL;
  try {
    u = new URL(s.includes("://") ? s : `https://${s}`);
  } catch {
    return null;
  }
  const host = u.hostname.toLowerCase().replace(/^www\./, "");
  return host || null;
}

/**
 * The registrable-ish tail: the last two labels of a host. Used only to SUGGEST
 * review candidates (`app.foo.com` vs `foo.com`), never to auto-link — this is
 * naively wrong for multi-part public suffixes like `.com.au`, which is exactly
 * why a tail agreement is reported as "review", not "match".
 */
export function tailOf(host: string | null): string | null {
  if (!host) return null;
  const parts = host.split(".");
  return parts.length <= 2 ? host : parts.slice(-2).join(".");
}

export type Proposal = {
  page: PageRow;
  /** Sites whose hostname is exactly the page's hostname. */
  exact: SiteRow[];
  /** Sites sharing only the registrable tail — an operator must confirm. */
  nearby: SiteRow[];
};

export type MatchReport = {
  proposals: Proposal[];
  /** Exactly one exact site, and the page is not already linked. */
  confident: Proposal[];
  /** Needs a human: several exact hits, or tail-only agreement. */
  ambiguous: Proposal[];
  /** Pages with a URL that LinkSpy has never seen. */
  unmatched: PageRow[];
  /** Pages already carrying a registrySiteId — never re-proposed. */
  alreadyLinked: PageRow[];
  /** Pages with no URL at all; nothing to match on. */
  noUrl: PageRow[];
  /** Sites no page pointed at — the other half of the adoption gap. */
  unusedSites: SiteRow[];
};

export function matchPages(pages: PageRow[], sites: SiteRow[]): MatchReport {
  const byHost = new Map<string, SiteRow[]>();
  const byTail = new Map<string, SiteRow[]>();
  const push = (m: Map<string, SiteRow[]>, k: string, s: SiteRow) => {
    const list = m.get(k);
    if (list) list.push(s);
    else m.set(k, [s]);
  };
  for (const s of sites) {
    const h = hostOf(s.url);
    if (!h) continue;
    push(byHost, h, s);
    const t = tailOf(h);
    if (t) push(byTail, t, s);
  }

  const report: MatchReport = {
    proposals: [], confident: [], ambiguous: [],
    unmatched: [], alreadyLinked: [], noUrl: [], unusedSites: [],
  };
  const touched = new Set<string>();

  for (const page of pages) {
    if (page.registrySiteId) { report.alreadyLinked.push(page); continue; }
    const host = hostOf(page.url);
    if (!host) { report.noUrl.push(page); continue; }

    const exact = byHost.get(host) ?? [];
    // Tail-only agreement: same registrable tail, different host.
    const tail = tailOf(host);
    const nearby = (tail ? byTail.get(tail) ?? [] : []).filter(
      (s) => hostOf(s.url) !== host,
    );

    if (!exact.length && !nearby.length) { report.unmatched.push(page); continue; }

    for (const s of [...exact, ...nearby]) touched.add(s.id);
    const proposal: Proposal = { page, exact, nearby };
    report.proposals.push(proposal);
    // Confident means one unambiguous destination — a page matching two sites
    // is a duplicate-site problem on the LinkSpy side, not a link decision.
    if (exact.length === 1) report.confident.push(proposal);
    else report.ambiguous.push(proposal);
  }

  report.unusedSites = sites.filter((s) => !touched.has(s.id));
  return report;
}

/**
 * A proposal is only actionable if the destination is visible to this app AND
 * capable of producing verdicts: an unannotated site is invisible through the
 * registry bridge, and an unmonitored one answers `couldnt_verify` forever.
 * Both are LinkSpy-side fixes, so they are reported rather than filtered away.
 */
export function blockers(site: SiteRow): string[] {
  const out: string[] = [];
  if (site.hasClient === false) out.push("no client_id — invisible via the registry bridge");
  if (site.monitored === false) out.push("monitoring off — would yield no verdicts");
  return out;
}
