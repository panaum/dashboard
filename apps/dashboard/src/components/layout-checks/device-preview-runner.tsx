"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { MonitorSmartphone, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { saveDevicePreviewRun } from "@/app/dashboard/layout-checks/actions";
import {
  IDLE_PROGRESS, isBusy, mergePoll, progressNote, progressPct, type RunProgress,
} from "@/lib/layout-checks/run-progress";

// Runs the page across the device matrix on the preview service, then saves
// the result so it becomes history and the next run has something to diff
// against. Same shape as CheckRunner: start, poll, save, refresh.
//
// With onProgress it is hosted by the Devices panel, which draws the progress
// over the device picker; the control then renders only its button, so the run
// is reported in one place instead of two.

type Scope = "primary" | "all";

export function DevicePreviewRunner({
  url,
  baselineServiceRunId,
  hasRuns,
  onProgress,
}: {
  url: string;
  baselineServiceRunId?: string | null;
  hasRuns: boolean;
  /** Hosted mode: the panel draws progress, this control just runs it. */
  onProgress?: (p: RunProgress) => void;
}) {
  const [progress, setProgress] = useState<RunProgress>(IDLE_PROGRESS);
  const [scope, setScope] = useState<Scope>("primary");
  const router = useRouter();
  const hosted = Boolean(onProgress);

  const run = useCallback(async () => {
    let p: RunProgress = { ...IDLE_PROGRESS, phase: "running" };
    const push = (patch: Parameters<typeof mergePoll>[1]) => {
      p = mergePoll(p, patch);
      setProgress(p);
      onProgress?.(p);
    };
    push({ phase: "running", message: "" });
    try {
      const started = await (await fetch("/api/devicepreview/monitor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, scope, baseline: baselineServiceRunId ?? undefined }),
      })).json();
      const id = started?.run_id;
      if (!id) {
        push({ phase: "failed", message: started?.unavailable ? "The preview service is not configured on this deployment."
          // Runs and live sessions share one slot on the service, so "busy"
          // has two causes and they are not interchangeable to a reader.
          : started?.error === "live_session_open"
            ? "The preview service is busy with a live session. End it, or try again in a moment."
          : started?.error === "run_capacity" ? "Another preview is running right now. Try again in a minute."
          : started?.detail ?? started?.error ?? "Could not start the preview." });
        return;
      }
      // 1.2s while capturing: a device that finishes between two polls is
      // never marked, so a faster poll is what makes the picker keep up.
      for (let i = 0; i < 500; i++) {
        await new Promise((r) => setTimeout(r, 1200));
        const data = await (await fetch(`/api/devicepreview/monitor?id=${encodeURIComponent(id)}`, { cache: "no-store" })).json();
        if (data?.progress) {
          push({ done: data.progress.done ?? null, total: data.progress.total ?? null, message: data.progress.message ?? null });
        }
        if (data?.status === "done") {
          push({ phase: "saving" });
          const saved = await saveDevicePreviewRun({ url, serviceRunId: id });
          if (saved?.error) { push({ phase: "failed", message: saved.error }); return; }
          push({ phase: "done" });
          router.refresh();
          return;
        }
        if (data?.status === "failed" || data?.status === "not_found" || data?.unavailable) {
          push({ phase: "failed", message: data?.error ?? "The preview did not finish." });
          return;
        }
      }
      push({ phase: "failed", message: "The preview took longer than expected and was abandoned." });
    } catch {
      push({ phase: "failed", message: "Could not reach the preview service." });
    }
  }, [url, scope, baselineServiceRunId, router, onProgress]);

  const busy = isBusy(progress);
  const note = progressNote(progress);

  return (
    <div className="flex flex-col items-start gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={scope}
          onChange={(e) => setScope(e.target.value as Scope)}
          disabled={busy}
          aria-label="Which devices to run"
          className="rounded-lg border border-border-soft bg-card px-2.5 py-2 text-[13px] text-text-primary"
        >
          <option value="primary">14 primary devices</option>
          <option value="all">All 15, including the 260px canary</option>
        </select>
        <Button onClick={run} disabled={busy}>
          {busy ? (
            <><RefreshCw className="size-4 animate-spin" /> Previewing…</>
          ) : (
            <><MonitorSmartphone className="size-4" /> {hasRuns ? "Run again" : "Preview on devices"}</>
          )}
        </Button>
      </div>
      {!hosted && busy && (
        <div className="w-64">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-card-soft">
            <div className="h-full rounded-full bg-accent transition-[width] duration-500"
                 style={{ width: `${Math.max(4, progressPct(progress))}%` }} />
          </div>
        </div>
      )}
      {!hosted && note && (
        <p className={`max-w-xs text-[12px] ${progress.phase === "failed" ? "text-error" : "text-text-muted"}`}>
          {note}
        </p>
      )}
    </div>
  );
}
