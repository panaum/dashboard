"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Monitor, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import {
  type ResponsiveFinding,
  type ResponsiveReport,
  FINDING_TONE,
  orderFindings,
  progressPercent,
  shotWidths,
  summarize,
  widthLabel,
} from "@/lib/linkspy/responsive-view";

// Eight page loads take 60-90s, so this starts a job on the backend and polls.
// The screenshots are the point: the findings say where to look, the images say
// whether it is real. They are fetched one at a time through the image proxy
// rather than inlined, so a 4MB run does not travel through the status JSON.

type Phase = "idle" | "running" | "done" | "failed";

export function ResponsivePanel({ url }: { url: string | null }) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [checkId, setCheckId] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ message?: string; percent?: number } | null>(null);
  const [report, setReport] = useState<ResponsiveReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const poll = useCallback((id: string) => {
    const tick = async () => {
      try {
        const res = await fetch(`/api/linkspy/monitor?view=responsive&id=${encodeURIComponent(id)}`,
          { cache: "no-store" });
        const data = await res.json();
        if (data?.unavailable) {
          setPhase("failed");
          setError("The checker service is not reachable right now.");
          return;
        }
        setProgress(data?.progress ?? null);
        if (data?.status === "done") {
          setReport(data.report ?? null);
          setPhase("done");
          return;
        }
        if (data?.status === "failed" || data?.status === "not_found") {
          setPhase("failed");
          setError(data?.error ?? "The sweep did not finish.");
          return;
        }
        timer.current = setTimeout(tick, 2500);
      } catch {
        setPhase("failed");
        setError("Lost contact with the checker.");
      }
    };
    timer.current = setTimeout(tick, 2500);
  }, []);

  const start = useCallback(async () => {
    if (!url) return;
    setPhase("running");
    setReport(null);
    setError(null);
    setProgress({ message: "Starting…", percent: 0 });
    try {
      const res = await fetch("/api/linkspy/monitor?action=responsive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const data = await res.json();
      if (data?.check_id) {
        setCheckId(data.check_id);
        poll(data.check_id);
      } else {
        setPhase("failed");
        setError(data?.detail ?? data?.error ?? "Could not start the sweep.");
      }
    } catch {
      setPhase("failed");
      setError("Could not reach the checker.");
    }
  }, [url, poll]);

  if (!url) {
    return (
      <Card className="px-5 py-6">
        <p className="text-sm text-text-secondary">
          This site has no URL recorded, so there is nothing to render.
        </p>
      </Card>
    );
  }

  const findings = orderFindings((report?.findings ?? []) as ResponsiveFinding[]);
  const widths = shotWidths(report);
  const summary = summarize(findings, widths.length || 8);
  const pct = progressPercent(progress);

  return (
    <div className="flex flex-col gap-4">
      <Card className="px-5 py-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="mb-1 flex items-center gap-2">
              <Monitor className="size-4 text-text-muted" strokeWidth={1.5} />
              <h3 className="text-sm font-semibold text-text-primary">How it looks on every screen</h3>
            </div>
            <p className="max-w-prose text-[13px] text-text-secondary">
              Opens the page at eight widths — from a small phone to a desktop — and
              reports anything that breaks: sideways scrolling, text cut off, text
              landing on top of other text, and where the main button sits.
            </p>
          </div>
          <Button onClick={start} disabled={phase === "running"}>
            {phase === "running" ? (
              <>
                <RefreshCw className="size-4 animate-spin" /> Checking…
              </>
            ) : phase === "done" ? (
              "Check again"
            ) : (
              "Check all screen sizes"
            )}
          </Button>
        </div>

        {phase === "running" && (
          <div className="mt-4">
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-card-soft">
              <div
                className="h-full rounded-full bg-accent transition-[width] duration-500"
                style={{ width: `${Math.max(4, pct)}%` }}
              />
            </div>
            <p className="mt-2 text-[12px] text-text-muted">
              {progress?.message ?? "Working…"} Takes about a minute and a half.
            </p>
          </div>
        )}

        {phase === "failed" && (
          <p className="mt-4 text-[13px] text-error">{error}</p>
        )}

        {phase === "done" && (
          <p className="mt-4 text-sm font-medium text-text-primary">{summary.headline}</p>
        )}
      </Card>

      {phase === "done" && findings.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>What the sweep found</CardTitle>
          </CardHeader>
          <div className="flex flex-col divide-y divide-border-soft">
            {findings.map((f) => (
              <div key={f.id} className="px-5 py-3.5">
                <div className="mb-1 flex items-center gap-2">
                  <Badge tone={FINDING_TONE[f.status]}>{f.status}</Badge>
                  <span className="text-sm font-medium text-text-primary">{f.title}</span>
                </div>
                {f.detail && (
                  <p className="max-w-prose text-[13px] text-text-secondary">{f.detail}</p>
                )}
                {!!f.evidence?.length && (
                  <ul className="mt-2 flex flex-col gap-0.5">
                    {f.evidence.slice(0, 6).map((e, i) => (
                      <li
                        key={i}
                        className="overflow-x-auto whitespace-pre font-mono text-[11px] leading-relaxed text-text-muted"
                      >
                        {e}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}

      {phase === "done" && widths.length > 0 && checkId && (
        <Card>
          <CardHeader>
            <CardTitle>Screenshots</CardTitle>
          </CardHeader>
          <div className="grid grid-cols-2 gap-3 px-5 pb-5 sm:grid-cols-4">
            {widths.map((w) => (
              <Dialog
                key={w}
                title={`${url} at ${w}px`}
                size="lg"
                trigger={
                  <button
                    type="button"
                    className="group flex flex-col gap-1.5 text-left"
                    aria-label={`Open the ${w}px screenshot`}
                  >
                    <span className="block overflow-hidden rounded-lg border border-border-soft bg-card-soft transition-colors group-hover:border-accent/50">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={`/api/linkspy/shot?id=${encodeURIComponent(checkId)}&width=${w}`}
                        alt={`The page rendered at ${w} pixels wide`}
                        loading="lazy"
                        className="block h-40 w-full object-cover object-top"
                      />
                    </span>
                    <span className="text-[12px] text-text-secondary">{widthLabel(w)}</span>
                  </button>
                }
              >
                {() => (
                  <div className="max-h-[70vh] overflow-auto rounded-lg border border-border-soft">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={`/api/linkspy/shot?id=${encodeURIComponent(checkId)}&width=${w}`}
                      alt={`The full page rendered at ${w} pixels wide`}
                      className="block w-full"
                    />
                  </div>
                )}
              </Dialog>
            ))}
          </div>
          <p className="px-5 pb-5 text-[12px] text-text-muted">
            Full-page captures. They live with this run and are not stored — run the
            check again to regenerate them.
          </p>
        </Card>
      )}
    </div>
  );
}
