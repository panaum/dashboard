"use client";

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, ChevronRight, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { plainAttribution, plainPlatform } from "@/lib/linkspy/attribution-plain";

// ATTRIBUTION CHECK — will this page's forms carry UTM and click ids into the
// lead, or do they arrive empty? Its own headless page load with test
// parameters attached, so it runs ON DEMAND behind a button rather than on
// every scan. The engine is the backend's attribution.py, the same code the
// CLI runs; this only renders the answer.

type Check = { name: string; status: "PASS" | "FAIL" | "WARN" | "INFO"; detail: string };
type Field = { name?: string; value?: string; hidden?: boolean };
type Form = { frame?: string; fields?: Field[] };
type Report = {
  outcome?: string;
  error?: string;
  platform?: string;
  platform_note?: string;
  checks?: Check[];
  forms?: Form[];
  failed?: boolean;
};

const TONE: Record<Check["status"], "success" | "error" | "warning" | "neutral"> = {
  PASS: "success", FAIL: "error", WARN: "warning", INFO: "neutral",
};


export function AttributionPanel({ url }: { url: string }) {
  const [state, setState] = useState<"idle" | "loading" | "done" | "failed">("idle");
  const [report, setReport] = useState<Report | null>(null);
  const [note, setNote] = useState("");
  const started = useRef(false);

  // Opening the tab IS the request — don't make the reader ask twice. The
  // parent mounts this only on first open and keeps it mounted afterwards,
  // so switching tabs never re-runs the check.
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Pagecheck loads the page twice (~35s), so it starts a job and we poll —
  // one long request would outlive the serverless budget and 504.
  async function run() {
    setState("loading");
    setNote("Starting the check…");
    try {
      const res = await fetch("/api/linkspy/monitor?action=pagecheck", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const body = await res.json();
      if (!res.ok || !body.check_id) {
        setNote(body.detail ?? body.error ?? "Could not start the check.");
        setState("failed");
        return;
      }
      const deadline = Date.now() + 3 * 60 * 1000;
      const poll = async () => {
        if (Date.now() > deadline) { setNote("The check took too long."); setState("failed"); return; }
        try {
          const snap = await (await fetch(
            `/api/linkspy/monitor?view=pagecheck&id=${encodeURIComponent(body.check_id)}`)).json();
          if (snap.status === "running") {
            setNote(snap.progress?.message ?? "Checking…");
            setTimeout(poll, 2500);
            return;
          }
          if (snap.status === "done" && snap.report) { setReport(snap.report); setState("done"); return; }
          setNote(snap.error ?? "The check did not complete.");
          setState("failed");
        } catch {
          setTimeout(poll, 4000);
        }
      };
      setTimeout(poll, 2500);
    } catch {
      setNote("Could not reach the checker.");
      setState("failed");
    }
  }

  if (state === "idle" || state === "loading") {
    return (
      <div className="mt-4">
        <p className="mb-3 flex items-center gap-2 text-[13px] text-text-secondary">
          <Loader2 className="size-4 animate-spin" />
          {note || "Opening the page as a visitor arriving from a campaign…"}
        </p>
        <p className="max-w-2xl text-[12px] text-text-muted">
          We attach test UTM and click-id parameters and read the form&apos;s hidden fields back.
          A field that exists but stays empty is the failure — the form works, leads arrive, and
          nobody can tell where they came from.
        </p>
      </div>
    );
  }

  if (state === "failed" || !report) {
    return (
      <p className="mt-4 text-[13px] text-text-secondary">
        {note || "The attribution check is unavailable right now — the rest of this scan is unaffected."}
      </p>
    );
  }

  const v = plainAttribution(report);
  const platform = plainPlatform(report);
  const fields = (report.forms ?? []).flatMap((f) =>
    (f.fields ?? [])
      .filter((x) => x.name && /utm|gclid|fbclid/i.test(x.name))
      .map((x) => ({ ...x, frame: f.frame })),
  );

  const RING = {
    error: "border-error/30 bg-error/5",
    warning: "border-warning/30 bg-warning/5",
    success: "border-success/30 bg-success/5",
    neutral: "border-border-soft bg-card-soft/50",
  }[v.tone];

  return (
    <div className="mt-4">
      {/* The answer, in the reader's terms, before any detail. */}
      <div className={`rounded-xl border p-4 ${RING}`}>
        <p className="flex items-start gap-2.5 text-[15px] font-semibold leading-snug text-text-primary">
          {v.tone === "success" ? (
            <CheckCircle2 className="mt-0.5 size-[18px] shrink-0 text-success" strokeWidth={2} />
          ) : v.tone === "neutral" ? null : (
            <AlertTriangle
              className={`mt-0.5 size-[18px] shrink-0 ${v.tone === "error" ? "text-error" : "text-warning"}`}
              strokeWidth={2}
            />
          )}
          {v.headline}
        </p>
        <p className="mt-2 max-w-2xl text-[13.5px] leading-relaxed text-text-secondary">{v.meaning}</p>
      </div>

      {v.findings.length > 0 && (
        <div className="mt-4">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-text-muted">
            What we found
          </p>
          <ul className="flex flex-col gap-1.5">
            {v.findings.map((f, i) => (
              <li key={i} className="flex gap-2.5 text-[13.5px] leading-relaxed text-text-secondary">
                <span aria-hidden className="mt-[9px] size-1 shrink-0 rounded-full bg-text-muted" />
                <span>{f}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {v.fix.length > 0 && (
        <div className="mt-4 rounded-lg border border-border-soft bg-card-soft/50 p-3.5">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-text-muted">
            How to fix it
          </p>
          <ol className="flex list-decimal flex-col gap-1.5 pl-4">
            {v.fix.map((f, i) => (
              <li key={i} className="text-[13.5px] leading-relaxed text-text-secondary">{f}</li>
            ))}
          </ol>
        </div>
      )}

      {/* Everything precise, one disclosure away — for whoever implements the fix. */}
      <details className="group mt-4">
        <summary className="flex cursor-pointer list-none items-center gap-1.5 text-[13px] font-medium text-text-secondary transition-colors hover:text-text-primary">
          <ChevronRight className="size-3.5 transition-transform group-open:rotate-90" strokeWidth={2} />
          Technical detail
          {platform && <span className="font-normal text-text-muted">· built on {platform}</span>}
        </summary>
        <div className="mt-3 border-l-2 border-border-soft pl-3.5">
          <ul className="flex flex-col gap-2">
            {(report.checks ?? []).map((c, i) => (
              <li key={`${c.name}-${i}`} className="flex items-start gap-2.5 text-[13px]">
                {c.status === "INFO" ? (
                  <span aria-hidden className="mt-[7px] size-1.5 shrink-0 rounded-full bg-text-muted" />
                ) : (
                  <Badge tone={TONE[c.status]}>{c.status}</Badge>
                )}
                <div className="min-w-0">
                  <span className="font-medium text-text-primary">{c.name}</span>
                  <span className="text-text-secondary"> — {c.detail}</span>
                </div>
              </li>
            ))}
          </ul>

          {fields.length > 0 && (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-left text-[13px]">
                <thead>
                  <tr className="border-b border-border-soft text-[11px] uppercase tracking-wide text-text-muted">
                    <th className="py-2 pr-4 font-semibold">Field</th>
                    <th className="py-2 pr-4 font-semibold">Value received</th>
                    <th className="py-2 font-semibold">Where</th>
                  </tr>
                </thead>
                <tbody>
                  {fields.map((f, i) => (
                    <tr key={`${f.name}-${i}`} className="border-b border-border-soft/60">
                      <td className="py-2 pr-4 font-mono text-text-primary">{f.name}</td>
                      <td className={`py-2 pr-4 font-mono ${f.value ? "text-text-secondary" : "text-error"}`}>
                        {f.value || "(empty)"}
                      </td>
                      <td className="py-2 text-text-muted">
                        {f.hidden ? "hidden" : "visible"}
                        {f.frame && f.frame !== "main" ? " · embedded" : ""}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </details>

      <button
        type="button"
        onClick={run}
        className="mt-4 text-[13px] font-medium text-accent transition-opacity hover:opacity-80"
      >
        Check again
      </button>
    </div>
  );
}
