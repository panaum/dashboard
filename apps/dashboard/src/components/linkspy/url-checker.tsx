"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, Loader2, ScanSearch } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  filterLinks, groupByZone, latencyTone, bucketBadge, scoreTone,
  type FullScan, type ScanFilter,
} from "@/lib/linkspy/scanner-view";
import { middleTruncate } from "@/lib/linkspy/monitor-metrics";

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

      {phase.kind === "done" && <ScanResult scan={phase.scan} />}
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

function ScanResult({ scan }: { scan: FullScan }) {
  const [filter, setFilter] = useState<ScanFilter>("all");
  const [query, setQuery] = useState("");
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

      {/* Results table: filter tabs + search */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
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

      <div className="mt-2 overflow-x-auto">
        <table className="w-full text-left text-[13px]">
          <thead>
            <tr className="border-b border-border-soft text-[11px] uppercase tracking-wide text-text-muted">
              <th className="py-2 pr-4 font-semibold">Status</th>
              <th className="py-2 pr-4 font-semibold">Link text</th>
              <th className="py-2 pr-4 font-semibold">URL</th>
              <th className="py-2 font-semibold">Time</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <FragmentZone key={g.zone} label={g.label} links={g.links} />
            ))}
            {shownCount === 0 && (
              <tr><td colSpan={4} className="py-6 text-center text-text-muted">No links match.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function FragmentZone({ label, links }: { label: string; links: FullScan["links"] }) {
  return (
    <>
      <tr>
        <td colSpan={4} className="bg-card-soft/60 px-1 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-text-muted">
          {label} · {links?.length ?? 0}
        </td>
      </tr>
      {(links ?? []).map((l, i) => {
        const badge = bucketBadge(l.bucket);
        const lat = latencyTone(l.response_ms);
        return (
          <tr key={`${l.url}-${i}`} className="border-b border-border-soft/60">
            <td className="py-2 pr-4"><Badge tone={badge.tone}>{badge.label}</Badge></td>
            <td className="max-w-56 truncate py-2 pr-4 text-text-primary" title={l.anchor_text ?? ""}>
              {l.anchor_text || <span className="text-text-muted">—</span>}
            </td>
            <td className="max-w-80 truncate py-2 pr-4 font-mono text-[12px] text-text-secondary" title={l.url}>
              {middleTruncate(l.url, 52)}
            </td>
            <td className={`py-2 tabular-nums ${TONE_CLASS[lat]}`}>
              {typeof l.response_ms === "number" ? `${l.response_ms}ms` : "—"}
            </td>
          </tr>
        );
      })}
    </>
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
      <Panel title="Link types" rows={linkTypes.map(([k, v]) => [k, v])} />
      <Panel title="Top hosts" rows={hosts.map((h) => [h.host, h.count])} />
      <Panel title="Link schemes" rows={schemes.map(([k, v]) => [k, v])} />
      <Panel
        title="Redirects"
        rows={[
          ["Permanent (301/308)", rd.permanent ?? 0],
          ["Temporary (302/307)", rd.temporary ?? 0],
          ["Collapsible rules", rd.collapsible_rules ?? 0],
        ]}
      />
    </div>
  );
}

function Panel({ title, rows }: { title: string; rows: Array<[string, number]> }) {
  return (
    <div className="rounded-lg border border-border-soft bg-card-soft/40 p-3">
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-text-muted">{title}</p>
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
