// SCANNER VIEW — pure shaping for the in-dashboard scanner (matches LinkSpy's
// scanner page). No I/O, no React.

export type FullLink = {
  url: string;
  anchor_text?: string | null;
  bucket: string; // ok | broken | unverifiable | dead_cta
  label?: string | null;
  status_code?: number | null;
  final_url?: string | null;
  response_ms?: number | null;
  resource_type?: string | null;
  category?: string | null;
  reason?: string | null;
  is_external?: boolean | null;
  occurrences?: number | null;
  priority?: string | null;
  zone: string;
};

export type Breakdowns = {
  link_types?: Record<string, number>;
  top_hosts?: Array<{ host: string; count: number }>;
  schemes?: Record<string, number>;
  redirects?: { permanent?: number; temporary?: number; total?: number; collapsible_rules?: number };
};

export type Integration = {
  host?: string;
  resource_url?: string;
  category?: string;
  type?: string;
  detected_id?: string;
  health?: string;
};

export type Integrations = { items?: Integration[]; total?: number; down?: number; unknown?: number };

/** Integration health → tone. Anything unrecognised is neutral, never green —
 *  an unknown state must not read as "verified healthy". */
export function integrationTone(health: string | null | undefined): "success" | "error" | "neutral" {
  const h = (health ?? "").toLowerCase();
  if (h === "down" || h === "broken" || h === "error") return "error";
  if (h === "healthy" || h === "ok" || h === "up") return "success";
  return "neutral";
}

export type FullScan = {
  health_score?: number | null;
  links?: FullLink[];
  unique_links?: number;
  placements?: number;
  totals?: { links: number; ok: number; broken: number; unverifiable: number; dead_cta: number };
  breakdowns?: Breakdowns;
  detected_builders?: string[];
  integrations?: Integrations;
  truncated?: boolean;
};

// Zone order for the grouped results table (spec: FORM, NAVIGATION, HEADER,
// CTA, BODY TEXT, FOOTER, OTHER). Unknown zones fall to the end, alpha.
const ZONE_ORDER = ["form", "navigation", "nav", "header", "cta", "body", "body_text", "footer"];
const ZONE_LABEL: Record<string, string> = {
  form: "Form", navigation: "Navigation", nav: "Navigation", header: "Header",
  cta: "CTA", body: "Body text", body_text: "Body text", footer: "Footer", other: "Other",
};

export function zoneLabel(zone: string): string {
  return ZONE_LABEL[zone] ?? (zone ? zone[0].toUpperCase() + zone.slice(1) : "Other");
}

export type ScanFilter = "all" | "working" | "broken" | "unverifiable";

export function filterLinks(links: FullLink[], filter: ScanFilter, query: string): FullLink[] {
  const q = query.trim().toLowerCase();
  return links.filter((l) => {
    if (filter === "working" && l.bucket !== "ok") return false;
    if (filter === "broken" && l.bucket !== "broken" && l.bucket !== "dead_cta") return false;
    if (filter === "unverifiable" && l.bucket !== "unverifiable") return false;
    if (q) {
      const hay = `${l.url} ${l.anchor_text ?? ""} ${l.final_url ?? ""}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

export type ZoneGroup = { zone: string; label: string; links: FullLink[] };

/** Group links by primary zone, ordered; broken links float to the top within
 *  each group (worst-first), then by anchor text. */
export function groupByZone(links: FullLink[]): ZoneGroup[] {
  const bucketRank: Record<string, number> = { broken: 0, dead_cta: 1, unverifiable: 2, ok: 3 };
  const byZone = new Map<string, FullLink[]>();
  for (const l of links) {
    const z = l.zone || "other";
    (byZone.get(z) ?? byZone.set(z, []).get(z)!).push(l);
  }
  const zoneRank = (z: string) => {
    const i = ZONE_ORDER.indexOf(z);
    return i === -1 ? ZONE_ORDER.length : i;
  };
  return [...byZone.entries()]
    .sort(([a], [b]) => zoneRank(a) - zoneRank(b) || a.localeCompare(b))
    .map(([zone, ls]) => ({
      zone,
      label: zoneLabel(zone),
      links: [...ls].sort(
        (a, b) =>
          (bucketRank[a.bucket] ?? 4) - (bucketRank[b.bucket] ?? 4) ||
          (a.anchor_text ?? "").localeCompare(b.anchor_text ?? ""),
      ),
    }));
}

/** Latency tint (spec §5): green < 300ms, amber < 1000ms, red ≥ 1000ms. */
export function latencyTone(ms: number | null | undefined): "success" | "warning" | "error" | "neutral" {
  if (typeof ms !== "number") return "neutral";
  if (ms < 300) return "success";
  if (ms < 1000) return "warning";
  return "error";
}

export function bucketBadge(bucket: string): { tone: "error" | "warning" | "neutral" | "success"; label: string } {
  if (bucket === "broken") return { tone: "error", label: "Broken" };
  if (bucket === "dead_cta") return { tone: "warning", label: "Dead CTA" };
  if (bucket === "unverifiable") return { tone: "neutral", label: "Unverifiable" };
  return { tone: "success", label: "OK" };
}

/** Health ring color by score (LinkSpy thresholds: ≥90 green, ≥70 amber, else red). */
export function scoreTone(score: number | null | undefined): "success" | "warning" | "error" | "neutral" {
  if (typeof score !== "number") return "neutral";
  if (score >= 90) return "success";
  if (score >= 70) return "warning";
  return "error";
}

/** Per-zone rollup for the collapsible results list. */
export type ZoneSummary = {
  total: number;
  broken: number;
  deadCta: number;
  unverifiable: number;
  ok: number;
  /** Nothing provably wrong — the zone can stay collapsed. */
  allClear: boolean;
};

export function zoneSummary(links: FullLink[]): ZoneSummary {
  let broken = 0, deadCta = 0, unverifiable = 0, ok = 0;
  for (const l of links) {
    if (l.bucket === "broken") broken++;
    else if (l.bucket === "dead_cta") deadCta++;
    else if (l.bucket === "unverifiable") unverifiable++;
    else ok++;
  }
  return {
    total: links.length, broken, deadCta, unverifiable, ok,
    // Unverifiable is not "wrong" — it must not force a zone open, and it
    // must not read as a failure (honesty rule).
    allClear: broken === 0 && deadCta === 0,
  };
}

/** One-line status for a collapsed zone header. */
export function zoneStatusLine(s: ZoneSummary): string {
  const parts: string[] = [];
  if (s.broken) parts.push(`${s.broken} broken`);
  if (s.deadCta) parts.push(`${s.deadCta} dead CTA${s.deadCta === 1 ? "" : "s"}`);
  if (parts.length) return parts.join(" · ");
  if (s.unverifiable) return `${s.unverifiable} unverifiable`;
  return "All working";
}

// ── Integrations grouping ────────────────────────────────────────────────────
// The raw list repeats a host once per resource it loaded (googletagmanager
// six times, facebook three). Readers care about "which third parties are on
// this page, and is any of them broken" — so group by category, dedupe by
// host, and carry the count + any detected ids.

export type HostRow = {
  host: string;
  count: number;
  ids: string[];
  tone: "success" | "error" | "neutral";
  health: string;
};

export type IntegrationGroup = { category: string; hosts: HostRow[]; problems: number };

const TONE_RANK = { error: 0, neutral: 1, success: 2 } as const;

export function groupIntegrations(items: Integration[] | undefined): IntegrationGroup[] {
  const byCategory = new Map<string, Map<string, HostRow>>();
  for (const it of items ?? []) {
    const host = it.host ?? "unknown";
    const category = it.category || "Other";
    const tone = integrationTone(it.health);
    const hosts = byCategory.get(category) ?? byCategory.set(category, new Map()).get(category)!;
    const row = hosts.get(host);
    if (!row) {
      hosts.set(host, {
        host, count: 1, ids: it.detected_id ? [it.detected_id] : [],
        tone, health: it.health ?? "unknown",
      });
    } else {
      row.count++;
      if (it.detected_id && !row.ids.includes(it.detected_id)) row.ids.push(it.detected_id);
      // Worst health wins: one broken resource makes the host worth looking at.
      if (TONE_RANK[tone] < TONE_RANK[row.tone]) {
        row.tone = tone;
        row.health = it.health ?? "unknown";
      }
    }
  }

  return [...byCategory.entries()]
    .map(([category, hosts]) => {
      const rows = [...hosts.values()].sort(
        (a, b) => TONE_RANK[a.tone] - TONE_RANK[b.tone] || b.count - a.count || a.host.localeCompare(b.host),
      );
      return { category, hosts: rows, problems: rows.filter((r) => r.tone !== "success").length };
    })
    // Categories with something to look at first, then largest, then A–Z.
    .sort((a, b) => (b.problems > 0 ? 1 : 0) - (a.problems > 0 ? 1 : 0) ||
                    b.hosts.length - a.hosts.length ||
                    a.category.localeCompare(b.category));
}
