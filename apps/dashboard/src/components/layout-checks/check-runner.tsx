"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { saveLayoutRun } from "@/app/dashboard/layout-checks/actions";
import { progressPercent } from "@/lib/linkspy/responsive-view";

// Runs the sweep on the checker service, then saves the result so it becomes
// history. The save is what makes "I asked the developer to fix it, retest"
// answerable — without it every run would be the first run.

type Phase = "idle" | "running" | "saving" | "done" | "failed";

export function CheckRunner({ url, label }: { url: string; label?: string }) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [note, setNote] = useState("");
  const [pct, setPct] = useState(0);
  const router = useRouter();

  const run = useCallback(async () => {
    setPhase("running");
    setNote("Loading the page at eight widths…");
    setPct(0);
    try {
      const started = await (await fetch("/api/linkspy/monitor?action=responsive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      })).json();
      const id = started?.check_id;
      if (!id) {
        setPhase("failed");
        setNote(started?.detail ?? started?.error ?? "Could not start the check.");
        return;
      }

      for (let i = 0; i < 80; i++) {
        await new Promise((r) => setTimeout(r, 2500));
        const data = await (await fetch(
          `/api/linkspy/monitor?view=responsive&id=${encodeURIComponent(id)}`,
          { cache: "no-store" },
        )).json();
        setPct(progressPercent(data?.progress));
        if (data?.progress?.message) setNote(data.progress.message);
        if (data?.status === "done") {
          setPhase("saving");
          setNote("Saving this run and its screenshots…");
          const saved = await saveLayoutRun({ url, checkId: id, report: data.report ?? {} });
          if (saved?.error) {
            setPhase("failed");
            setNote(saved.error);
            return;
          }
          setPhase("done");
          setNote("Saved.");
          router.refresh();
          return;
        }
        if (data?.status === "failed" || data?.status === "not_found" || data?.unavailable) {
          setPhase("failed");
          setNote(data?.error ?? "The check did not finish.");
          return;
        }
      }
      setPhase("failed");
      setNote("The check took longer than expected and was abandoned.");
    } catch {
      setPhase("failed");
      setNote("Could not reach the checker.");
    }
  }, [url, router]);

  const busy = phase === "running" || phase === "saving";

  return (
    <div className="flex flex-col items-end gap-2">
      <Button onClick={run} disabled={busy}>
        {busy ? (
          <>
            <RefreshCw className="size-4 animate-spin" /> Checking…
          </>
        ) : (
          <>
            <Play className="size-4" /> {label ?? "Run check"}
          </>
        )}
      </Button>
      {busy && (
        <div className="w-56">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-card-soft">
            <div className="h-full rounded-full bg-accent transition-[width] duration-500"
                 style={{ width: `${Math.max(4, pct)}%` }} />
          </div>
        </div>
      )}
      {note && (
        <p className={`max-w-xs text-right text-[12px] ${phase === "failed" ? "text-error" : "text-text-muted"}`}>
          {note}
          {phase === "running" && " Takes about a minute and a half."}
        </p>
      )}
    </div>
  );
}
