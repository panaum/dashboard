"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, ChevronRight, Loader2, ScanSearch } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  filterLinks, groupByZone, latencyTone, bucketBadge, scoreTone, integrationTone,
  zoneSummary, zoneStatusLine, groupIntegrations, categoryAccent,
  type FullScan, type FullLink, type ScanFilter,
} from "@/lib/linkspy/scanner-view";
import { middleTruncate } from "@/lib/linkspy/monitor-metrics";
import { ScannerXray } from "@/components/linkspy/scanner-xray";

// IN-DASHBOARD SCANNER — the full LinkSpy scanner, no redirect: score ring,
// stat strip, breakdown panels, and every link grouped by zone with filter +
// search. Starts a real scan through the session-guarded proxy and polls.

type Phase =
  | { kind: "idle" }
  | { kind: "running"; id: string; message: string; percent: number }
  | { kind: "done"; scan: FullScan }
  | { kind: "failed"; message: string };

const POLL_MS = 2500;
const TONE_CLASS: Record<string, string> = {
  success: "text-success", warning: "text-warning", error: "text-error", neutral: "text-text-muted",
};
const TONE_STROKE: Record<string, string> = {
  success: "stroke-success", warning: "stroke-warning", error: "stroke-error", neutral: "stroke-text-muted",
};

// Four decorative slots from the brand palette. Deliberately pastel and
// distinct from the health colours (success/warning/error), so a category's
// colour is never mistaken for a status. Full class strings — Tailwind can't
// see interpolated names.
const ACCENTS = [
  { dot: "bg-brand-purple", tint: "bg-brand-purple/15", hoverBorder: "hover:border-brand-purple" },
  { dot: "bg-brand-blue", tint: "bg-brand-blue/15", hoverBorder: "hover:border-brand-blue" },
  { dot: "bg-brand-peach", tint: "bg-brand-peach/15", hoverBorder: "hover:border-brand-peach" },
  { dot: "bg-brand-yellow", tint: "bg-brand-yellow/25", hoverBorder: "hover:border-brand-yellow" },
] as const;

export function UrlChecker() {
  const [url, setUrl] = useState("");
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  useEffect(() => {
    const onPrefill = (e: Event) => {
      const detail = (e as CustomEvent<string>).detail;
      if (typeof detail === "string") setUrl(detail);
    };
    window.addEventListener("checker:prefill", onPrefill);
    return () => window.removeEventListener("checker:prefill", onPrefill);
  }, []);

  async function poll(id: string) {
    try {
      const snap = await (await fetch(`/api/linkspy/check?id=${encodeURIComponent(id)}`)).json();
      if (snap.status === "running") {
        setPhase({ kind: "running", id, message: snap.progress?.message ?? "Scanning…", percent: snap.progress?.percent ?? 0 });
        timer.current = setTimeout(() => poll(id), POLL_MS);
      } else if (snap.status === "done" && snap.full) {
        setPhase({ kind: "done", scan: snap.full });
      } else if (snap.status === "failed") {
        setPhase({ kind: "failed", message: snap.error ?? "The scan failed." });
      } else {
        setPhase({ kind: "failed", message: "The check went missing — try again." });
      }
    } catch {
      timer.current = setTimeout(() => poll(id), POLL_MS * 2);
    }
  }

  async function start(e: React.FormEvent) {
    e.preventDefault();
    if (!url.trim() || phase.kind === "running") return;
    setPhase({ kind: "running", id: "", message: "Starting…", percent: 0 });
    try {
      const res = await fetch("/api/linkspy/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim() }),
      });
      const body = await res.json();
      if (res.ok && body.check_id) {
        setPhase({ kind: "running", id: body.check_id, message: "Starting…", percent: 0 });
        timer.current = setTimeout(() => poll(body.check_id), POLL_MS);
      } else {
        setPhase({ kind: "failed", message: body.detail ?? body.error ?? "Could not start the scan — LinkSpy may be busy." });
      }
    } catch {
      setPhase({ kind: "failed", message: "Could not reach the scanner — try again." });
    }
  }

  return (
    <div className="mb-6 rounded-xl border border-border-soft bg-card p-4 shadow-xs">
      <form onSubmit={start} className="flex items-center gap-2">
        <input
          type="text"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          required
          placeholder="Paste any URL — we crawl every nav, footer, CTA, header and body link and report what's broken."
          className="flex-1 rounded-lg border border-border-soft bg-card px-3 py-2 text-sm text-text-primary shadow-xs placeholder:text-text-muted focus:border-accent/50 focus:outline-none"
        />
        <button
          type="submit"
          disabled={phase.kind === "running"}
          className="inline-flex items-center gap-2 rounded-lg bg-accent px-3.5 py-2 text-sm font-medium text-white shadow-xs transition-opacity hover:opacity-90 disabled:opacity-60"
        >
          {phase.kind === "running" ? <Loader2 className="size-4 animate-spin" /> : <ScanSearch className="size-4" strokeWidth={1.75} />}
          {phase.kind === "running" ? "Scanning" : "Scan page"}
        </button>
      </form>

      {phase.kind === "running" && (
        <div className="mt-3">
          <div className="mb-1.5 flex items-center justify-between text-[13px] text-text-secondary">
            <span>{phase.message}</span>
            <span className="tabular-nums">{phase.percent}%</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-card-soft">
            <div className="h-full rounded-full bg-accent transition-all duration-500" style={{ width: `${Math.max(phase.percent, 4)}%` }} />
          </div>
        </div>
      )}

      {phase.kind === "failed" && <p className="mt-3 text-[13px] text-error">{phase.message}</p>}

      {phase.kind === "done" && <ScanResult scan={phase.scan} url={url} />}
    </div>
  );
}

function ScoreRing({ score }: { score: number | null | undefined }) {
  const tone = scoreTone(score);
  const pct = typeof score === "number" ? score : 0;
  const r = 26;
  const c = 2 * Math.PI * r;
  return (
    <svg width="64" height="64" viewBox="0 0 64 64" className="shrink-0">
      <circle cx="32" cy="32" r={r} className="stroke-border-soft" strokeWidth="5" fill="none" />
      <circle
        cx="32" cy="32" r={r} strokeWidth="5" fill="none" strokeLinecap="round"
        className={TONE_STROKE[tone]}
        strokeDasharray={c} strokeDashoffset={c - (pct / 100) * c}
        transform="rotate(-90 32 32)"
      />
      <text x="32" y="37" textAnchor="middle" className={`fill-current font-mono text-[16px] font-semibold ${TONE_CLASS[tone]}`}>
        {typeof score === "number" ? score : "—"}
      </text>
    </svg>
  );
}

function ScanResult({ scan, url }: { scan: FullScan; url: string }) {
  const [filter, setFilter] = useState<ScanFilter>("all");
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<"results" | "integrations" | "xray">("results");
  const links = scan.links ?? [];
  const t = scan.totals ?? { links: 0, ok: 0, broken: 0, unverifiable: 0, dead_cta: 0 };
  const allClear = t.broken === 0 && t.dead_cta === 0;
  const groups = useMemo(() => groupByZone(filterLinks(links, filter, query)), [links, filter, query]);
  const shownCount = groups.reduce((n, g) => n + g.links.length, 0);

  return (
    <div className="mt-4">
      {/* Hero: score ring + verdict + stat line */}
      <div className="flex items-start gap-4 border-b border-border-soft pb-4">
        <ScoreRing score={scan.health_score} />
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2 text-sm font-medium text-text-primary">
            {allClear ? (
              <><CheckCircle2 className="size-4 text-success" strokeWidth={1.75} /> All clear — no broken links on watch.</>
            ) : (
              <>{t.broken + t.dead_cta} issue{t.broken + t.dead_cta === 1 ? "" : "s"} found across this page.</>
            )}
          </p>
          <p className="mt-1 text-[13px] text-text-secondary">
            {scan.unique_links ?? t.links} unique links across {scan.placements ?? t.links} placements ·{" "}
            <span className={t.broken ? "text-error" : "text-text-muted"}>{t.broken} broken</span> ·{" "}
            <span className={t.dead_cta ? "text-warning" : "text-text-muted"}>{t.dead_cta} dead CTAs</span> ·{" "}
            <span className="text-text-muted">{t.unverifiable} unverifiable</span>
          </p>
          {scan.detected_builders && scan.detected_builders.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {scan.detected_builders.map((b) => <Badge key={b} tone="neutral">{b}</Badge>)}
            </div>
          )}
        </div>
      </div>

      {/* Breakdown panels */}
      <Breakdowns scan={scan} />

      {/* View tabs */}
      <div className="mt-4 flex items-center gap-1 border-b border-border-soft">
        {([
          ["results", `Results (${t.links})`],
          ["integrations", `Integrations (${scan.integrations?.total ?? 0})`],
          ["xray", "X-ray view"],
        ] as const).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={`-mb-px border-b-2 px-3 py-2 text-[13px] font-medium transition-colors ${
              tab === key
                ? "border-accent text-accent"
                : "border-transparent text-text-secondary hover:text-text-primary"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "integrations" && <IntegrationsPanel scan={scan} />}
      {tab === "xray" && <div className="mt-4"><ScannerXray url={url} /></div>}

      {/* Results table: filter tabs + search */}
      <div className={`mt-4 flex flex-wrap items-center gap-2 ${tab === "results" ? "" : "hidden"}`}>
        {([["all", "All"], ["working", "Working"], ["broken", "Broken"], ["unverifiable", "Unverifiable"]] as const).map(
          ([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setFilter(key)}
              className={`rounded-lg px-2.5 py-1.5 text-[13px] font-medium transition-colors ${
                filter === key ? "bg-accent/10 text-accent" : "text-text-secondary hover:text-text-primary"
              }`}
            >
              {label}
            </button>
          ),
        )}
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search URLs or link text…"
          className="ml-auto w-56 rounded-lg border border-border-soft bg-card px-3 py-1.5 text-[13px] text-text-primary shadow-xs placeholder:text-text-muted focus:border-accent/50 focus:outline-none"
        />
        <span className="text-[12px] text-text-muted tabular-nums">{shownCount} links</span>
      </div>

      <div className={`mt-3 flex flex-col gap-2 ${tab === "results" ? "" : "hidden"}`}>
        {groups.map((g) => (
          <ZoneSection key={g.zone} label={g.label} links={g.links} searching={query.trim().length > 0} />
        ))}
        {shownCount === 0 && (
          <p className="py-8 text-center text-[13px] text-text-muted">No links match.</p>
        )}
      </div>
    </div>
  );
}

const PAGE_SIZE = 25;

/** One zone as a collapsible section. Zones with something provably wrong open
 *  themselves; clean zones stay shut so a 61-link footer never buries an
 *  8-link CTA block. A search opens everything — you asked to see matches. */
function ZoneSection({
  label, links, searching,
}: {
  label: string; links: FullLink[]; searching: boolean;
}) {
  const summary = zoneSummary(links);
  const [open, setOpen] = useState(!summary.allClear);
  const [limit, setLimit] = useState(PAGE_SIZE);
  const expanded = open || searching;
  const shown = links.slice(0, limit);

  return (
    <section className="overflow-hidden rounded-lg border border-border-soft">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={expanded}
        className="flex w-full items-center gap-3 bg-card-soft/50 px-3 py-2.5 text-left transition-colors hover:bg-card-soft"
      >
        <ChevronRight
          className={`size-4 shrink-0 text-text-muted transition-transform ${expanded ? "rotate-90" : ""}`}
          strokeWidth={1.75}
        />
        <span className="text-[13px] font-semibold text-text-primary">{label}</span>
        <span className="text-[12px] tabular-nums text-text-muted">
          {summary.total} link{summary.total === 1 ? "" : "s"}
        </span>
        <span className="ml-auto flex items-center gap-1.5">
          {summary.allClear ? (
            <span className="flex items-center gap-1.5 text-[12px] text-text-muted">
              <CheckCircle2 className="size-3.5 text-success" strokeWidth={1.75} />
              {zoneStatusLine(summary)}
            </span>
          ) : (
            <Badge tone={summary.broken ? "error" : "warning"}>{zoneStatusLine(summary)}</Badge>
          )}
        </span>
      </button>

      {expanded && (
        <ul className="divide-y divide-border-soft/70">
          {shown.map((l, i) => {
            const badge = bucketBadge(l.bucket);
            const lat = latencyTone(l.response_ms);
            return (
              <li
                key={`${l.url}-${i}`}
                className={`flex items-center gap-3 px-3 py-2.5 ${
                  l.bucket === "broken" ? "bg-error/5" : l.bucket === "dead_cta" ? "bg-warning/5" : ""
                }`}
              >
                {/* A dot, not a badge, for the common "ok" case: 100 identical
                    green pills is noise; a dot lets the eye skip to the reds. */}
                {l.bucket === "ok" ? (
                  <span className="size-1.5 shrink-0 rounded-full bg-success" title="OK" />
                ) : (
                  <Badge tone={badge.tone}>{badge.label}</Badge>
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] text-text-primary" title={l.anchor_text ?? ""}>
                    {l.anchor_text || <span className="text-text-muted">(no link text)</span>}
                  </p>
                  <p className="truncate font-mono text-[11px] text-text-muted" title={l.url}>
                    {middleTruncate(l.url, 64)}
                  </p>
                </div>
                {l.reason && (
                  <span className="hidden max-w-48 truncate text-[12px] text-error lg:inline" title={l.reason}>
                    {l.reason}
                  </span>
                )}
                <span className={`shrink-0 text-[12px] tabular-nums ${TONE_CLASS[lat]}`}>
                  {typeof l.response_ms === "number" ? `${l.response_ms}ms` : "—"}
                </span>
              </li>
            );
          })}
          {links.length > limit && (
            <li className="px-3 py-2">
              <button
                type="button"
                onClick={() => setLimit((n) => n + PAGE_SIZE * 2)}
                className="text-[13px] font-medium text-accent transition-opacity hover:opacity-80"
              >
                Show {Math.min(links.length - limit, PAGE_SIZE * 2)} more of {links.length}
              </button>
            </li>
          )}
        </ul>
      )}
    </section>
  );
}

function IntegrationsPanel({ scan }: { scan: FullScan }) {
  const ints = scan.integrations;
  const items = ints?.items ?? [];
  if (!items.length) {
    return (
      <p className="mt-4 text-[13px] text-text-secondary">
        No third-party integrations detected on this page.
      </p>
    );
  }
  const groups = groupIntegrations(items);
  const uniqueHosts = groups.reduce((n, g) => n + g.hosts.length, 0);
  const problems = (ints?.down ?? 0) + (ints?.unknown ?? 0);

  return (
    <div className="mt-4">
      <p className="mb-3 text-[13px] text-text-secondary">
        <span className="font-medium text-text-primary">{uniqueHosts} third parties</span> on this page
        {" "}across {groups.length} categor{groups.length === 1 ? "y" : "ies"}
        {problems === 0 ? (
          <span className="text-text-muted"> · all responding</span>
        ) : (
          <>
            {(ints?.down ?? 0) > 0 && <span className="text-error"> · {ints?.down} down</span>}
            {(ints?.unknown ?? 0) > 0 && <span className="text-text-muted"> · {ints?.unknown} unverified</span>}
          </>
        )}
      </p>

      <div className="grid gap-3 sm:grid-cols-2">
        {groups.map((g) => {
          const accent = ACCENTS[categoryAccent(g.category)];
          return (
          <div
            key={g.category}
            className={`overflow-hidden rounded-lg border border-border-soft transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md ${accent.hoverBorder}`}
          >
            <div className={`flex items-center gap-2 border-b border-border-soft/70 px-3 py-2 ${accent.tint}`}>
              <span aria-hidden className={`size-2 shrink-0 rounded-full ${accent.dot}`} />
              <span className="text-[11px] font-semibold uppercase tracking-wide text-text-secondary">
                {g.category}
              </span>
              <span className="text-[11px] tabular-nums text-text-muted">{g.hosts.length}</span>
              {g.problems > 0 && <Badge tone="error">{g.problems} to check</Badge>}
            </div>
            <div className="p-3">
            <ul className="flex flex-col gap-1.5">
              {g.hosts.map((h) => (
                <li key={h.host} className="flex items-center gap-2 text-[13px]">
                  {/* Healthy is a quiet dot — 35 identical green pills was the
                      noise that hid anything worth seeing. */}
                  {h.tone === "success" ? (
                    <span className="size-1.5 shrink-0 rounded-full bg-success" title="Responding" />
                  ) : (
                    <Badge tone={h.tone}>{h.health}</Badge>
                  )}
                  <span className="truncate font-mono text-text-primary" title={h.host}>{h.host}</span>
                  {h.count > 1 && (
                    <span className="shrink-0 text-[11px] tabular-nums text-text-muted">×{h.count}</span>
                  )}
                  {h.ids.length > 0 && (
                    <span
                      className="ml-auto shrink-0 truncate font-mono text-[11px] text-text-muted"
                      title={h.ids.join(", ")}
                    >
                      {h.ids[0]}
                    </span>
                  )}
                </li>
              ))}
            </ul>
            </div>
          </div>
          );
        })}
      </div>

      <p className="mt-3 text-[12px] text-text-muted">
        A provider outage never counts against this page&apos;s health score.
      </p>
    </div>
  );
}

function Breakdowns({ scan }: { scan: FullScan }) {
  const b = scan.breakdowns ?? {};
  const linkTypes = Object.entries(b.link_types ?? {}).sort((a, c) => c[1] - a[1]).slice(0, 6);
  const hosts = (b.top_hosts ?? []).slice(0, 6);
  const schemes = Object.entries(b.schemes ?? {}).sort((a, c) => c[1] - a[1]);
  const rd = b.redirects ?? {};
  if (!linkTypes.length && !hosts.length && !schemes.length && !rd.total) return null;

  return (
    <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Panel title="Link types" slot={0} rows={linkTypes.map(([k, v]) => [k, v])} />
      <Panel title="Top hosts" slot={1} rows={hosts.map((h) => [h.host, h.count])} />
      <Panel title="Link schemes" slot={2} rows={schemes.map(([k, v]) => [k, v])} />
      <Panel
        title="Redirects"
        slot={3}
        rows={[
          ["Permanent (301/308)", rd.permanent ?? 0],
          ["Temporary (302/307)", rd.temporary ?? 0],
          ["Collapsible rules", rd.collapsible_rules ?? 0],
        ]}
      />
    </div>
  );
}

function Panel({ title, rows, slot }: { title: string; rows: Array<[string, number]>; slot: 0 | 1 | 2 | 3 }) {
  const accent = ACCENTS[slot];
  return (
    <div
      className={`rounded-lg border border-border-soft bg-card p-3 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md ${accent.hoverBorder}`}
    >
      <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-text-muted">
        <span aria-hidden className={`size-2 rounded-full ${accent.dot}`} />
        {title}
      </p>
      {rows.length === 0 ? (
        <p className="text-[12px] text-text-muted">—</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {rows.map(([k, v]) => (
            <li key={k} className="flex items-center justify-between gap-2 text-[12px]">
              <span className="truncate font-mono text-text-secondary" title={k}>{k}</span>
              <span className="font-mono font-semibold tabular-nums text-text-primary">{v}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
