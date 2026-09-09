// LIST VIEW — the Layout checks index, shaped. Pure: no Prisma, no React.
//
// The list answers three questions at a glance: which pages are broken, when
// each was last looked at, and what it looked like. Everything here exists to
// answer one of those; the sorting and the chips are pure so they can be
// tested without a database.

import { agoWords, type Tone } from "@/lib/layout-checks/verdict";

/** The newest eight-width run of a page, as the list needs it. */
export type ViewportsRow = {
  checkedAt: string;
  worst: string;
  failCount: number;
  warnCount: number;
} | null;

/** The newest device-matrix run of a page. */
export type DevicesRow = {
  checkedAt: string;
  worst: string;
  errorCount: number;
  warnCount: number;
  deviceCount: number;
} | null;

/** Where the list gets a picture of the page: a stored width, or a device fold. */
export type Thumb =
  | { kind: "width"; runId: string; width: number }
  | { kind: "device"; runId: string; profile: string }
  | null;

export type ListRow = {
  id: string;
  url: string;
  label: string | null;
  viewports: ViewportsRow;
  devices: DevicesRow;
  thumb: Thumb;
};

export type Chip = { label: string; tone: Tone };

/** The name a person recognises: their label, else the URL without its scheme. */
export function displayName(row: { label: string | null; url: string }): string {
  return row.label?.trim() || row.url.replace(/^https?:\/\//, "").replace(/\/$/, "");
}

export function thumbSrc(t: Thumb): string | null {
  if (!t) return null;
  return t.kind === "width"
    ? `/api/layout-shot?runId=${t.runId}&width=${t.width}`
    : `/api/devicepreview/shot?runId=${t.runId}&profile=${encodeURIComponent(t.profile)}`;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** "2 breaks" — the count that matters, not the verdict word. */
export function viewportsChip(r: ViewportsRow): Chip {
  if (!r) return { label: "Not run", tone: "neutral" };
  if (r.worst === "SKIP") return { label: "Couldn't check", tone: "neutral" };
  if (r.failCount > 0) return { label: plural(r.failCount, "break"), tone: "error" };
  if (r.warnCount > 0) return { label: `${r.warnCount} to review`, tone: "warning" };
  return { label: "Clean", tone: "success" };
}

export function devicesChip(d: DevicesRow): Chip {
  if (!d) return { label: "Not run", tone: "neutral" };
  if (d.worst === "BLOCKED") return { label: "Blocked", tone: "neutral" };
  if (d.errorCount > 0) return { label: plural(d.errorCount, "error"), tone: "error" };
  if (d.worst === "REGRESSED") return { label: "Changed", tone: "warning" };
  if (d.warnCount > 0) return { label: `${d.warnCount} to review`, tone: "warning" };
  return { label: d.deviceCount ? `Clean on ${d.deviceCount}` : "Clean", tone: "success" };
}

/** The most recent time anyone looked at this page, by either check. */
export function lastCheckedIso(row: ListRow): string | null {
  const times = [row.viewports?.checkedAt, row.devices?.checkedAt].filter(Boolean) as string[];
  if (!times.length) return null;
  return times.sort().at(-1)!;
}

/** "checked 2 hours ago", or the honest absence of a check. */
export function lastCheckedWords(row: ListRow, nowMs: number = Date.now()): string {
  const iso = lastCheckedIso(row);
  return iso ? `checked ${agoWords(iso, nowMs)}` : "never checked";
}

// Worst first, because a broken page must never sit below the fold under clean
// ones. A page nobody has checked ranks above a clean one: an unknown is a
// question, and a question outranks a settled answer.
//
// Only checks that actually ran count. Never running the device matrix says
// nothing about the page, so it must not drag a page that is clean at eight
// widths down to the level of one nobody has looked at.
const RANK: Record<string, number> = { error: 0, warning: 1, neutral: 2, success: 3 };

export function rowRank(row: ListRow): number {
  const tones: Tone[] = [];
  if (row.viewports) tones.push(viewportsChip(row.viewports).tone);
  if (row.devices) tones.push(devicesChip(row.devices).tone);
  if (!tones.length) return RANK.neutral;   // never checked at all
  return Math.min(...tones.map((t) => RANK[t]));
}

export type SortMode = "worst" | "recent" | "name";

export function sortRows(rows: ListRow[], mode: SortMode): ListRow[] {
  const out = [...rows];
  if (mode === "name") {
    return out.sort((a, b) => displayName(a).localeCompare(displayName(b)));
  }
  if (mode === "recent") {
    // Never-checked pages have nothing to be recent about; they go last.
    return out.sort((a, b) => (lastCheckedIso(b) ?? "").localeCompare(lastCheckedIso(a) ?? ""));
  }
  return out.sort((a, b) => {
    const d = rowRank(a) - rowRank(b);
    return d !== 0 ? d : (lastCheckedIso(b) ?? "").localeCompare(lastCheckedIso(a) ?? "");
  });
}

/** Substring match on the name and the URL, case- and space-insensitive. */
export function filterRows(rows: ListRow[], query: string): ListRow[] {
  const q = query.trim().toLowerCase();
  if (!q) return rows;
  return rows.filter((r) =>
    displayName(r).toLowerCase().includes(q) || r.url.toLowerCase().includes(q));
}

/** The one line above the list: what is wrong across every page. */
export function listSummary(rows: ListRow[]): string {
  if (!rows.length) return "";
  const broken = rows.filter((r) => rowRank(r) === 0).length;
  const review = rows.filter((r) => rowRank(r) === 1).length;
  const never = rows.filter((r) => !lastCheckedIso(r)).length;
  const parts: string[] = [];
  if (broken) parts.push(`${plural(broken, "page")} breaking`);
  if (review) parts.push(`${review} to review`);
  if (never) parts.push(`${never} never checked`);
  if (!parts.length) return `All ${plural(rows.length, "page")} clean.`;
  return parts.join(" · ");
}
