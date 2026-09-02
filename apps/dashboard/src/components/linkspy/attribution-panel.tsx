"use client";

import { useEffect, useRef, useState } from "react";
import { CheckCircle2, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";

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

const OUTCOME_COPY: Record<string, string> = {
  load_failed: "The page did not load",
  timeout: "The page took too long to load",
  no_form: "No form was found on this page",
};

export function AttributionPanel({ url }: { url: string }) {
  const [state, setState] = useState<"idle" | "loading" | "done" | "failed">("idle");
  const [report, setReport] = useState<Report | null>(null);
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

  async function run() {
    setState("loading");
    try {
      const res = await fetch(`/api/linkspy/monitor?view=attribution&url=${encodeURIComponent(url)}`);
      const body = (await res.json()) as Report & { unavailable?: boolean; error?: string };
      if (!res.ok || body.unavailable || !body.checks) {
        setState("failed");
        setReport(body ?? null);
      } else {
        setReport(body);
        setState("done");
      }
    } catch {
      setState("failed");
    }
  }

  if (state === "idle" || state === "loading") {
    return (
      <div className="mt-4">
        <p className="mb-3 flex items-center gap-2 text-[13px] text-text-secondary">
          <Loader2 className="size-4 animate-spin" />
          Opening the page as a visitor arriving from a campaign…
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
        The attribution check is unavailable right now — the rest of this scan is unaffected.
      </p>
    );
  }

  const outcome = report.outcome && report.outcome !== "ok" ? report.outcome : null;
  const fields = (report.forms ?? []).flatMap((f) =>
    (f.fields ?? [])
      .filter((x) => x.name && /utm|gclid|fbclid/i.test(x.name))
      .map((x) => ({ ...x, frame: f.frame })),
  );

  return (
    <div className="mt-4">
      {outcome && (
        <p className="mb-3 text-[13px] text-error">
          {OUTCOME_COPY[outcome] ?? outcome}
          {report.error ? ` — ${report.error}` : ""}
        </p>
      )}

      <ul className="flex flex-col gap-2">
        {(report.checks ?? []).map((c, i) => (
          <li key={`${c.name}-${i}`} className="flex items-start gap-2.5 text-[13px]">
            {c.status === "PASS" ? (
              <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" strokeWidth={1.75} />
            ) : c.status === "INFO" ? (
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
        <div className="mt-4">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-text-muted">
            Attribution fields on the page
          </p>
          <div className="overflow-x-auto">
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
                      {f.frame && f.frame !== "main" ? " · iframe" : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={run}
        className="mt-4 text-[13px] font-medium text-accent transition-opacity hover:opacity-80"
      >
        Run again
      </button>
    </div>
  );
}
