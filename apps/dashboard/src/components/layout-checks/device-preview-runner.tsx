"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { MonitorSmartphone, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { saveDevicePreviewRun } from "@/app/dashboard/layout-checks/actions";

// Runs the page across the device matrix on the preview service, then saves
// the result so it becomes history and the next run has something to diff
// against. Same shape as CheckRunner: start, poll, save, refresh.

type Phase = "idle" | "running" | "saving" | "done" | "failed";
type Scope = "primary" | "all";

export function DevicePreviewRunner({
  url,
  baselineServiceRunId,
  hasRuns,
}: {
  url: string;
  baselineServiceRunId?: string | null;
  hasRuns: boolean;
}) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [scope, setScope] = useState<Scope>("primary");
  const [note, setNote] = useState("");
  const [done, setDone] = useState(0);
  const [total, setTotal] = useState<number | null>(null);
  const router = useRouter();

  const run = useCallback(async () => {
    setPhase("running");
    setNote("Starting the browsers…");
    setDone(0); setTotal(null);
    try {
      const started = await (await fetch("/api/devicepreview/monitor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, scope, baseline: baselineServiceRunId ?? undefined }),
      })).json();
      const id = started?.run_id;
      if (!id) {
        setPhase("failed");
        setNote(started?.unavailable ? "The preview service is not configured on this deployment."
          : started?.error === "run_capacity" ? "Another preview is running right now. Try again in a minute."
          : started?.detail ?? started?.error ?? "Could not start the preview.");
        return;
      }
      for (let i = 0; i < 240; i++) {
        await new Promise((r) => setTimeout(r, 2500));
        const data = await (await fetch(`/api/devicepreview/monitor?id=${encodeURIComponent(id)}`, { cache: "no-store" })).json();
        if (data?.progress) {
          setDone(data.progress.done ?? 0);
          setTotal(data.progress.total ?? null);
          if (data.progress.message) setNote(data.progress.message);
        }
        if (data?.status === "done") {
          setPhase("saving");
          setNote("Saving this run and its screenshots…");
          const saved = await saveDevicePreviewRun({ url, serviceRunId: id });
          if (saved?.error) { setPhase("failed"); setNote(saved.error); return; }
          setPhase("done"); setNote("Saved.");
          router.refresh();
          return;
        }
        if (data?.status === "failed" || data?.status === "not_found" || data?.unavailable) {
          setPhase("failed");
          setNote(data?.error ?? "The preview did not finish.");
          return;
        }
      }
      setPhase("failed");
      setNote("The preview took longer than expected and was abandoned.");
    } catch {
      setPhase("failed");
      setNote("Could not reach the preview service.");
    }
  }, [url, scope, baselineServiceRunId, router]);

  const busy = phase === "running" || phase === "saving";
  const pct = total ? Math.round((done / total) * 100) : 0;

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex items-center gap-2">
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
      {busy && (
        <div className="w-64">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-card-soft">
            <div className="h-full rounded-full bg-accent transition-[width] duration-500"
                 style={{ width: `${Math.max(4, pct)}%` }} />
          </div>
          {total ? <p className="mt-1 text-right text-[11px] text-text-muted">{done} of {total} devices</p> : null}
        </div>
      )}
      {note && (
        <p className={`max-w-xs text-right text-[12px] ${phase === "failed" ? "text-error" : "text-text-muted"}`}>
          {note}
          {phase === "running" && " Takes one to two minutes."}
        </p>
      )}
    </div>
  );
}
