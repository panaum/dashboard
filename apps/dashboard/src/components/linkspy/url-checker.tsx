"use client";

import { useEffect, useRef, useState } from "react";
import { CheckCircle2, Loader2, ScanSearch } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  buildScanView,
  bucketTone,
  healthTone,
  type ScanPayload,
} from "@/lib/linkspy/sites-view";

// IN-DASHBOARD URL CHECKER — no redirect: starts a real LinkSpy scan through
// the session-guarded proxy and polls until the result renders right here.
// The scan also persists on the LinkSpy side, so history and diffs accrue
// exactly as if it had been run from the checker UI.

type Phase =
  | { kind: "idle" }
  | { kind: "running"; id: string; message: string; percent: number }
  | { kind: "done"; summary: ScanPayload & { health_score?: number | null } }
  | { kind: "failed"; message: string };

const POLL_MS = 2500;

export function UrlChecker() {
  const [url, setUrl] = useState("");
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  async function poll(id: string) {
    try {
      const res = await fetch(`/api/linkspy/check?id=${encodeURIComponent(id)}`);
      const snap = await res.json();
      if (snap.status === "running") {
        setPhase({
          kind: "running", id,
          message: snap.progress?.message ?? "Scanning…",
          percent: snap.progress?.percent ?? 0,
        });
        timer.current = setTimeout(() => poll(id), POLL_MS);
      } else if (snap.status === "done" && snap.summary) {
        setPhase({ kind: "done", summary: snap.summary });
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
        setPhase({
          kind: "failed",
          message: body.detail ?? body.error ?? "Could not start the check — LinkSpy may be busy.",
        });
      }
    } catch {
      setPhase({ kind: "failed", message: "Could not reach the checker — try again." });
    }
  }

  const view = phase.kind === "done" ? buildScanView(phase.summary) : null;

  return (
    <div className="mb-6 rounded-xl border border-border-soft bg-card p-4 shadow-xs">
      <form onSubmit={start} className="flex items-center gap-2">
        <input
          type="text"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          required
          placeholder="Check a URL for broken links…"
          className="flex-1 rounded-lg border border-border-soft bg-card px-3 py-2 text-sm text-text-primary shadow-xs placeholder:text-text-muted focus:border-accent/50 focus:outline-none"
        />
        <button
          type="submit"
          disabled={phase.kind === "running"}
          className="inline-flex items-center gap-2 rounded-lg bg-accent px-3.5 py-2 text-sm font-medium text-white shadow-xs transition-opacity hover:opacity-90 disabled:opacity-60"
        >
          {phase.kind === "running" ? (
            <Loader2 className="size-4 animate-spin" strokeWidth={1.75} />
          ) : (
            <ScanSearch className="size-4" strokeWidth={1.75} />
          )}
          {phase.kind === "running" ? "Scanning" : "Scan"}
        </button>
      </form>

      {phase.kind === "running" && (
        <div className="mt-3">
          <div className="mb-1.5 flex items-center justify-between text-[13px] text-text-secondary">
            <span>{phase.message}</span>
            <span>{phase.percent}%</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-card-soft">
            <div
              className="h-full rounded-full bg-accent transition-all duration-500"
              style={{ width: `${Math.max(phase.percent, 4)}%` }}
            />
          </div>
        </div>
      )}

      {phase.kind === "failed" && (
        <p className="mt-3 text-[13px] text-error">{phase.message}</p>
      )}

      {phase.kind === "done" && view && (view.state === "clean" || view.state === "issues") && (
        <div className="mt-3">
          <p className="mb-2 flex flex-wrap items-center gap-2 text-[13px] text-text-secondary">
            {typeof phase.summary.health_score === "number" && (
              <Badge tone={healthTone(phase.summary.health_score)}>
                {phase.summary.health_score} health
              </Badge>
            )}
            <span>
              {view.totals.links} links checked · {view.totals.ok} ok · {view.totals.broken} broken
              · {view.totals.dead_cta} dead CTAs · {view.totals.unverifiable} unverifiable
            </span>
          </p>
          {view.state === "clean" ? (
            <p className="flex items-center gap-2 text-sm text-text-primary">
              <CheckCircle2 className="size-4 text-success" strokeWidth={1.75} />
              All links passed
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[13px]">
                <thead>
                  <tr className="border-b border-border-soft text-[11px] uppercase tracking-wide text-text-muted">
                    <th className="py-2 pr-4 font-semibold">Link</th>
                    <th className="py-2 pr-4 font-semibold">State</th>
                    <th className="py-2 font-semibold">Why</th>
                  </tr>
                </thead>
                <tbody>
                  {view.flagged.map((f, i) => (
                    <tr key={`${f.url}-${i}`} className="border-b border-border-soft/60">
                      <td className="max-w-90 truncate py-2 pr-4 text-text-primary" title={f.url}>
                        {f.url}
                      </td>
                      <td className="py-2 pr-4">
                        <Badge tone={bucketTone(f.bucket)}>
                          {f.bucket === "dead_cta" ? "dead CTA" : (f.bucket ?? "flagged")}
                        </Badge>
                      </td>
                      <td className="py-2 text-text-secondary">
                        {f.reason ?? f.label ?? (f.status_code ? `HTTP ${f.status_code}` : "—")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
