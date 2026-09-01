"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { createPortal } from "react-dom";
import {
  ChevronRight, Globe, Loader2, MoreHorizontal, Plus, RefreshCw, ScanSearch, Trash2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import {
  bandChip, cleanStreakDays, displayName, issueLine, latestScan,
  middleTruncate, relativeTime, scoreDelta, sortSites, sparkScores, statusChip,
  type DashboardSite,
} from "@/lib/linkspy/monitor-metrics";
import { healthTone } from "@/lib/linkspy/sites-view";

// MONITORING GRID (spec §2) — every monitored LinkSpy site as a card:
// status, health score + delta, sparkline, streaks, re-scan / settings /
// delete. Data arrives server-rendered; actions go through the
// session-guarded /api/linkspy/* proxies and refetch.

const FREQS = ["Every Hour", "Every 2 Hours", "Daily", "Weekly", "Monthly", "On Demand"];
const POLL_MS = 2500;

type Props = {
  initialSites: DashboardSite[];
  bands: Record<string, string>;
  unavailable: boolean;
};

export function MonitorGrid({ initialSites, bands, unavailable }: Props) {
  const [sites, setSites] = useState<DashboardSite[]>(initialSites);
  const [scanning, setScanning] = useState<Set<string>>(new Set());
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<DashboardSite | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  const refetch = useCallback(async () => {
    try {
      const res = await fetch("/api/linkspy/monitor?view=dashboard");
      const body = await res.json();
      if (alive.current && Array.isArray(body.sites)) {
        setSites(body.sites);
        setNow(Date.now());
      }
    } catch { /* keep prior data */ }
  }, []);

  // Menus close on Escape (click-outside is per-menu below).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMenuFor(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const markScanning = (id: string, on: boolean) =>
    setScanning((prev) => {
      const next = new Set(prev);
      if (on) next.add(id); else next.delete(id);
      return next;
    });

  const rescan = useCallback(async (site: DashboardSite) => {
    setActionError(null);
    markScanning(site.id, true);
    try {
      const res = await fetch("/api/linkspy/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: site.url, persist: true, email: site.user_email }),
      });
      const body = await res.json();
      if (!res.ok || !body.check_id) {
        setActionError(body.detail ?? body.error ?? "Could not start the scan.");
        markScanning(site.id, false);
        return;
      }
      const deadline = Date.now() + 16 * 60 * 1000; // hard cap ≥ backend's own
      await new Promise<void>((resolve) => {
        const poll = async () => {
          if (Date.now() > deadline) {
            setActionError("The scan is taking too long — check back shortly.");
            return resolve();
          }
          try {
            const snap = await (await fetch(`/api/linkspy/check?id=${body.check_id}`)).json();
            if (snap.status === "running") return void setTimeout(poll, POLL_MS);
            if (snap.status === "failed") setActionError(snap.error ?? "The scan failed.");
            // A backend redeploy drops the in-memory job → "not_found": say so,
            // rather than silently stopping. The scan may still have persisted.
            if (snap.status === "not_found") {
              setActionError("The scan was interrupted — its result may still have saved. Reloading…");
            }
            return resolve();
          } catch {
            // Transient network error — retry until the deadline, don't abandon.
            return void setTimeout(poll, POLL_MS * 2);
          }
        };
        setTimeout(poll, POLL_MS);
      });
    } finally {
      markScanning(site.id, false);
      await refetch();
    }
  }, [refetch]);

  const scanAll = useCallback(async () => {
    for (const s of sites) await rescan(s);
  }, [sites, rescan]);

  const addSite = async (fields: Record<string, string>, close: () => void) => {
    setActionError(null);
    const res = await fetch("/api/linkspy/monitor", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(fields),
    });
    const body = await res.json().catch(() => ({}));
    if (res.ok && body.status === "success") {
      close();
      await refetch();
    } else {
      setActionError(body.error ?? "Could not add the site.");
    }
  };

  const deleteSite = async (site: DashboardSite) => {
    setConfirmDelete(null);
    const res = await fetch(`/api/linkspy/monitor?id=${encodeURIComponent(site.id)}`, {
      method: "DELETE",
    });
    if (res.ok) setSites((prev) => prev.filter((s) => s.id !== site.id));
    else setActionError("Could not delete the site.");
  };

  const ordered = sortSites(sites);
  const commonEmail = modalEmail(sites);

  return (
    <div>
      {/* Action strip — the counts live in the stat rail above. */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold text-text-primary">All sites</h2>
        <span className="flex-1" />
        <button
          type="button"
          onClick={scanAll}
          disabled={sites.length === 0 || scanning.size > 0}
          className="inline-flex items-center gap-2 rounded-lg border border-border-soft bg-card px-3 py-2 text-sm font-medium text-text-secondary shadow-xs transition-colors hover:text-text-primary disabled:opacity-50"
        >
          <RefreshCw className="size-4" strokeWidth={1.5} /> Scan all
        </button>
        <button
          type="button"
          disabled
          title="Coming soon"
          className="rounded-lg border border-border-soft bg-card px-3 py-2 text-sm font-medium text-text-secondary opacity-50 shadow-xs"
        >
          Export
        </button>
        <Dialog
          title="Add site"
          trigger={
            <span className="inline-flex cursor-pointer items-center gap-2 rounded-lg bg-accent px-3.5 py-2 text-sm font-medium text-white shadow-xs transition-opacity hover:opacity-90">
              <Plus className="size-4" strokeWidth={1.75} /> Add site
            </span>
          }
        >
          {(close) => <AddSiteForm defaultEmail={commonEmail} onSubmit={(f) => addSite(f, close)} />}
        </Dialog>
      </div>

      {actionError && <p className="mb-3 text-[13px] text-error">{actionError}</p>}
      {unavailable && (
        <p className="mb-3 text-[13px] text-text-secondary">
          LinkSpy did not answer — showing nothing rather than something wrong. Reload in a minute.
        </p>
      )}

      {ordered.length === 0 && !unavailable ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border-soft bg-card px-6 py-14 text-center">
          <Globe className="mb-3 size-6 text-text-muted" strokeWidth={1.5} />
          <p className="text-sm font-medium text-text-primary">
            No targets on watch. Add a site to begin surveillance.
          </p>
        </div>
      ) : (
        <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))" }}>
          {ordered.map((site) => (
            <SiteCard
              key={site.id}
              site={site}
              band={bands[site.id]}
              now={now}
              scanning={scanning.has(site.id)}
              menuOpen={menuFor === site.id}
              onMenu={(open) => setMenuFor(open ? site.id : null)}
              onRescan={() => rescan(site)}
              onDelete={() => { setMenuFor(null); setConfirmDelete(site); }}
            />
          ))}
        </div>
      )}

      {confirmDelete && (
        <ConfirmDelete
          site={confirmDelete}
          onCancel={() => setConfirmDelete(null)}
          onConfirm={() => deleteSite(confirmDelete)}
        />
      )}
    </div>
  );
}

function modalEmail(sites: DashboardSite[]): string {
  const counts = new Map<string, number>();
  for (const s of sites) counts.set(s.user_email, (counts.get(s.user_email) ?? 0) + 1);
  let best = "";
  let n = 0;
  for (const [email, c] of counts) if (c > n) { best = email; n = c; }
  return best;
}

function SiteCard({
  site, band, now, scanning, menuOpen, onMenu, onRescan, onDelete,
}: {
  site: DashboardSite; band?: string; now: number; scanning: boolean;
  menuOpen: boolean; onMenu: (open: boolean) => void;
  onRescan: () => void; onDelete: () => void;
}) {
  const chip = statusChip(site);
  const stability = bandChip(band);
  const last = latestScan(site);
  const delta = scoreDelta(site);
  const streak = cleanStreakDays(site, now);
  const spark = sparkScores(site);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onMenu(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [menuOpen, onMenu]);

  // Status colour lives on a hairline rail down the card's left edge — a
  // health signal you can scan down the grid without reading a single word.
  const rail = {
    error: "bg-error", warning: "bg-warning", success: "bg-success", neutral: "bg-border-soft",
  }[chip.tone];
  const scoreColor = last
    ? { success: "text-success", warning: "text-warning", error: "text-error", neutral: "text-text-primary" }[
        healthTone(last.health_score)
      ]
    : "text-text-muted";

  return (
    <Card
      hover
      className={`group relative flex flex-col gap-3 overflow-hidden p-4 pl-5 ${menuOpen ? "z-20" : ""}`}
    >
      <span aria-hidden className={`absolute inset-y-0 left-0 w-1 ${rail}`} />

      <div className="flex items-start gap-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-card-soft text-sm font-semibold text-text-secondary">
          {displayName(site).charAt(0).toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-text-primary">{displayName(site)}</p>
          <p className="truncate font-mono text-[12px] text-text-muted" title={site.url}>
            {middleTruncate(site.url)}
          </p>
        </div>
        <Link
          href={`/dashboard/sites/${site.id}?u=${encodeURIComponent(site.url)}`}
          className="mt-1 text-text-muted transition-colors group-hover:text-accent"
          aria-label={`Open ${displayName(site)}`}
        >
          <ChevronRight className="size-4" />
        </Link>
      </div>

      <div className="flex items-end justify-between gap-3">
        <div>
          <p className={`font-mono text-[34px] font-semibold leading-none tabular-nums ${scoreColor}`}>
            {last ? last.health_score : "—"}
            <span className="text-sm font-normal text-text-muted"> / 100</span>
          </p>
          <p className="mt-1.5 text-[12px] tabular-nums">
            {delta.kind === "delta" && (
              <span className={delta.value > 0 ? "text-success" : "text-error"}>
                {delta.value > 0 ? "▲ +" : "▼ "}{delta.value} vs last
              </span>
            )}
            {delta.kind === "no_change" && <span className="text-text-muted">No change</span>}
            {delta.kind === "no_previous" && <span className="text-text-muted">No previous scan</span>}
            {delta.kind === "pending" && <span className="text-text-muted">First scan pending</span>}
          </p>
        </div>
        {spark.length >= 2 && <Sparkline scores={spark} />}
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <Badge tone={chip.tone}>{chip.label}</Badge>
        {stability && (
          <Badge tone={stability.tone} title="Stability band — how often this site breaks over time">
            {stability.label}
          </Badge>
        )}
        {streak !== null && streak > 0 && (
          <span
            className="ml-auto font-mono text-[12px] font-medium text-accent"
            title="Days since the last provable issue"
          >
            {streak}d clean
          </span>
        )}
      </div>

      <p className="text-[13px] text-text-secondary">{issueLine(site)}</p>

      <div className="mt-auto flex items-center gap-2 border-t border-border-soft pt-3 text-[12px] text-text-muted">
        <span className="flex-1" title={site.last_scanned_at ?? undefined}>
          {site.last_scanned_at ? `Scanned ${relativeTime(site.last_scanned_at, now)}` : "Never scanned"}
        </span>
        <button
          type="button"
          onClick={onRescan}
          disabled={scanning}
          className="inline-flex items-center gap-1.5 rounded-md border border-border-soft bg-card px-2.5 py-1.5 font-medium text-text-secondary transition-colors hover:text-text-primary disabled:opacity-60"
        >
          {scanning ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" strokeWidth={1.5} />}
          Re-scan
        </button>
        <div className="relative" ref={menuRef}>
          <button
            type="button"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={() => onMenu(!menuOpen)}
            className="rounded-md p-1.5 text-text-muted transition-colors hover:bg-card-soft hover:text-text-primary"
          >
            <MoreHorizontal className="size-4" />
          </button>
          {menuOpen && (
            <div
              role="menu"
              className="absolute right-0 top-8 z-30 w-44 overflow-hidden rounded-lg border border-border-soft bg-card py-1 shadow-md"
            >
              <Link
                role="menuitem"
                href={`/dashboard/sites/${site.id}?u=${encodeURIComponent(site.url)}`}
                className="block px-3 py-2 text-[13px] text-text-secondary transition-colors hover:bg-card-soft hover:text-text-primary"
              >
                Site settings
              </Link>
              <button
                role="menuitem"
                type="button"
                onClick={() => {
                  onMenu(false);
                  window.dispatchEvent(new CustomEvent("checker:prefill", { detail: site.url }));
                  window.scrollTo({ top: 0, behavior: "smooth" });
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] text-text-secondary transition-colors hover:bg-card-soft hover:text-text-primary"
              >
                <ScanSearch className="size-3.5" strokeWidth={1.5} /> Open in scanner
              </button>
              <button
                role="menuitem"
                type="button"
                onClick={onDelete}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] text-error transition-colors hover:bg-error/10"
              >
                <Trash2 className="size-3.5" strokeWidth={1.5} /> Delete site
              </button>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}

function Sparkline({ scores }: { scores: number[] }) {
  const min = Math.min(...scores);
  const max = Math.max(...scores);
  const span = Math.max(max - min, 1);
  const pts = scores
    .map((s, i) => `${(i / (scores.length - 1)) * 60},${18 - ((s - min) / span) * 16}`)
    .join(" ");
  return (
    <svg width="60" height="20" viewBox="0 0 60 20" className="shrink-0 text-accent" aria-hidden>
      <polyline points={pts} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

function AddSiteForm({
  defaultEmail, onSubmit,
}: {
  defaultEmail: string;
  onSubmit: (fields: Record<string, string>) => void;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        const data = new FormData(e.currentTarget);
        await onSubmit({
          url: String(data.get("url") ?? ""),
          name: String(data.get("name") ?? ""),
          client: String(data.get("client") ?? ""),
          user_email: String(data.get("user_email") ?? ""),
          freq: String(data.get("freq") ?? "On Demand"),
        });
        setBusy(false);
      }}
      className="flex flex-col gap-3"
    >
      {[
        { name: "url", label: "URL", placeholder: "https://example.com" },
        { name: "name", label: "Client name", placeholder: "Acme" },
        { name: "user_email", label: "Notification email", placeholder: "team@apexure.com" },
      ].map((f) => (
        <label key={f.name} className="flex flex-col gap-1 text-[13px] font-medium text-text-secondary">
          {f.label}
          <input
            name={f.name}
            required
            defaultValue={f.name === "user_email" ? defaultEmail : undefined}
            placeholder={f.placeholder}
            className="rounded-lg border border-border-soft bg-card px-3 py-2 text-sm text-text-primary shadow-xs placeholder:text-text-muted focus:border-accent/50 focus:outline-none"
          />
        </label>
      ))}
      <label className="flex flex-col gap-1 text-[13px] font-medium text-text-secondary">
        Scan frequency
        <select
          name="freq"
          defaultValue="Daily"
          className="rounded-lg border border-border-soft bg-card px-3 py-2 text-sm text-text-primary shadow-xs focus:border-accent/50 focus:outline-none"
        >
          {FREQS.map((f) => <option key={f}>{f}</option>)}
        </select>
      </label>
      <button
        type="submit"
        disabled={busy}
        className="mt-1 inline-flex items-center justify-center gap-2 rounded-lg bg-accent px-3.5 py-2 text-sm font-medium text-white shadow-xs transition-opacity hover:opacity-90 disabled:opacity-60"
      >
        {busy && <Loader2 className="size-4 animate-spin" />} Add site
      </button>
    </form>
  );
}

function ConfirmDelete({
  site, onCancel, onConfirm,
}: {
  site: DashboardSite; onCancel: () => void; onConfirm: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onCancel();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={onCancel}>
      <div
        className="w-full max-w-sm rounded-xl border border-border-soft bg-card p-5 shadow-md"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="mb-1 text-sm font-semibold text-text-primary">Delete site</p>
        <p className="mb-4 text-[13px] text-text-secondary">
          This permanently removes <strong>{displayName(site)}</strong> and all its scan history.
          This can&apos;t be undone.
        </p>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-border-soft bg-card px-3 py-2 text-sm font-medium text-text-secondary transition-colors hover:text-text-primary"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="rounded-lg bg-error px-3 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90"
          >
            Delete
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
