// MONITOR METRICS — pure shaping for the monitoring dashboard (spec §1, §4).
// No I/O, no React, no clock reads: `now` is always injected.

export type DashboardScan = {
  id: string;
  scanned_at: string;
  total_links: number;
  broken_count: number;
  dead_cta_count: number;
  health_score: number;
};

export type DashboardSite = {
  id: string;
  url: string;
  name?: string | null;
  client?: string | null;
  freq?: string | null;
  user_email: string;
  last_scanned_at: string | null;
  scans: DashboardScan[];
};

const DAY_MS = 86_400_000;

export function sortedScans(site: DashboardSite): DashboardScan[] {
  return [...(site.scans ?? [])].sort(
    (a, b) => Date.parse(a.scanned_at) - Date.parse(b.scanned_at),
  );
}

export function latestScan(site: DashboardSite): DashboardScan | null {
  const s = sortedScans(site);
  return s.length ? s[s.length - 1] : null;
}

const hasIssue = (s: DashboardScan) => s.broken_count > 0 || s.dead_cta_count > 0;

/** Spec §4 — clean streak in whole days. null with no scans; 0 when the
 *  latest scan has a provable issue; else days since the last scan that had
 *  one (or since the FIRST scan if none ever did). Unverifiable never counts. */
export function cleanStreakDays(site: DashboardSite, nowMs: number): number | null {
  const scans = sortedScans(site);
  if (!scans.length) return null;
  if (hasIssue(scans[scans.length - 1])) return 0;
  let anchor = scans[0].scanned_at;
  for (let i = scans.length - 1; i >= 0; i--) {
    if (hasIssue(scans[i])) {
      anchor = scans[i].scanned_at;
      break;
    }
  }
  const days = Math.floor((nowMs - Date.parse(anchor)) / DAY_MS);
  return Math.max(days, 0);
}

/** Spec §4 — fixed this month: per site with ≥2 scans, sum every positive
 *  DROP in (broken + dead_cta) between consecutive scans whose later scan
 *  falls in the current calendar month (UTC). Increases add nothing. */
export function fixedThisMonth(sites: DashboardSite[], nowMs: number): number {
  const now = new Date(nowMs);
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  let fixed = 0;
  for (const site of sites) {
    const scans = sortedScans(site);
    for (let i = 1; i < scans.length; i++) {
      const later = new Date(Date.parse(scans[i].scanned_at));
      if (later.getUTCFullYear() !== y || later.getUTCMonth() !== m) continue;
      const before = scans[i - 1].broken_count + scans[i - 1].dead_cta_count;
      const after = scans[i].broken_count + scans[i].dead_cta_count;
      if (after < before) fixed += before - after;
    }
  }
  return fixed;
}

/** Spec §2 sort: open issues first, then health ascending (worst first),
 *  never-scanned last. Stable within groups by url. */
export function sortSites(sites: DashboardSite[]): DashboardSite[] {
  const rank = (s: DashboardSite) => {
    const last = latestScan(s);
    if (!last) return { group: 2, health: 101 };
    return { group: hasIssue(last) ? 0 : 1, health: last.health_score };
  };
  return [...sites].sort((a, b) => {
    const ra = rank(a), rb = rank(b);
    return ra.group - rb.group || ra.health - rb.health || a.url.localeCompare(b.url);
  });
}

export type StatusChip = { tone: "error" | "warning" | "success" | "neutral"; label: string };

export function statusChip(site: DashboardSite): StatusChip {
  const last = latestScan(site);
  if (!last) return { tone: "neutral", label: "Not scanned yet" };
  if (last.broken_count > 0) return { tone: "error", label: "Broken links" };
  if (last.dead_cta_count > 0) return { tone: "warning", label: "Needs attention" };
  return { tone: "success", label: "Healthy" };
}

/** Health delta vs the previous scan. */
export function scoreDelta(site: DashboardSite):
  | { kind: "delta"; value: number }
  | { kind: "no_change" }
  | { kind: "no_previous" }
  | { kind: "pending" } {
  const scans = sortedScans(site);
  if (!scans.length) return { kind: "pending" };
  if (scans.length < 2) return { kind: "no_previous" };
  const d = scans[scans.length - 1].health_score - scans[scans.length - 2].health_score;
  return d === 0 ? { kind: "no_change" } : { kind: "delta", value: d };
}

export function issueLine(site: DashboardSite): string {
  const last = latestScan(site);
  if (!last) return "Run the first scan to see issues";
  const parts: string[] = [];
  if (last.broken_count > 0) parts.push(`${last.broken_count} broken`);
  if (last.dead_cta_count > 0) {
    parts.push(`${last.dead_cta_count} dead CTA${last.dead_cta_count === 1 ? "" : "s"}`);
  }
  return parts.length ? parts.join(" · ") : "No issues found";
}

/** Display name: given name, else the domain (www. stripped). Never a
 *  "No client name" placeholder. */
export function displayName(site: DashboardSite): string {
  if (site.name?.trim()) return site.name.trim();
  try {
    return new URL(site.url).hostname.replace(/^www\./, "");
  } catch {
    return site.url;
  }
}

/** Middle-truncate a URL: domain + final path segment stay visible. */
export function middleTruncate(url: string, max = 44): string {
  if (url.length <= max) return url;
  try {
    const u = new URL(url);
    const segs = u.pathname.split("/").filter(Boolean);
    const tail = segs.length ? `/…/${segs[segs.length - 1]}` : "";
    const head = `${u.hostname}`;
    const out = `${head}${tail}`;
    return out.length <= max ? out : `${head.slice(0, max - 6)}…${out.slice(-5)}`;
  } catch {
    return `${url.slice(0, max - 10)}…${url.slice(-9)}`;
  }
}

/** "just now" / "Nm ago" / "Nh ago" / "Nd ago" / "Never scanned". */
export function relativeTime(iso: string | null | undefined, nowMs: number): string {
  if (!iso) return "Never scanned";
  const ms = nowMs - Date.parse(iso);
  if (!Number.isFinite(ms)) return "Never scanned";
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

/** Last 6 health scores for the sparkline. Empty unless there are ≥ 2 scans
 *  AND the score actually moved: a flat line drawn through six identical
 *  values is a chart of nothing, and the card already says "No change". */
export function sparkScores(site: DashboardSite): number[] {
  const scans = sortedScans(site);
  if (scans.length < 2) return [];
  const scores = scans.slice(-6).map((s) => s.health_score);
  return Math.min(...scores) === Math.max(...scores) ? [] : scores;
}

export type BandChip = { label: string; tone: "success" | "neutral" | "warning" };

/** Stability band chip (spec §2); null when unknown — never blocks a card. */
export function bandChip(band: string | null | undefined): BandChip | null {
  if (band === "sturdy") return { label: "Sturdy", tone: "success" };
  if (band === "normal") return { label: "Steady", tone: "neutral" };
  if (band === "brittle") return { label: "Brittle", tone: "warning" };
  return null;
}

/** Portfolio summary for the Sites stat rail. */
export type MonitorSummary = {
  monitored: number;
  healthy: number;
  attention: number; // broken OR dead-CTA on the latest scan
  neverScanned: number;
  fixed: number; // fixed this month
  avgHealth: number | null; // mean latest health across scanned sites
};

export function monitorSummary(sites: DashboardSite[], nowMs: number): MonitorSummary {
  let healthy = 0, attention = 0, never = 0, healthSum = 0, scanned = 0;
  for (const s of sites) {
    const last = latestScan(s);
    if (!last) { never++; continue; }
    scanned++;
    healthSum += last.health_score;
    if (last.broken_count > 0 || last.dead_cta_count > 0) attention++;
    else healthy++;
  }
  return {
    monitored: sites.length,
    healthy,
    attention,
    neverScanned: never,
    fixed: fixedThisMonth(sites, nowMs),
    avgHealth: scanned ? Math.round(healthSum / scanned) : null,
  };
}
