"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { ClipboardCheck, Check, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { confirmMachineItem } from "@/app/dashboard/clients/[clientId]/[projectId]/[pageId]/actions";
import {
  type Proposal,
  byItemName,
  proposalsFromPagecheck,
  proposalsFromSweep,
  toFindings,
} from "@/lib/linkspy/pagecheck-map";

// Runs the page in a real browser and proposes answers for the checklist rows
// it can honestly answer. It never writes: the Confirm click calls the same
// server action the LinkSpy prefills use, which is the ONLY bridge from a
// machine result into a signed-off row (T4).

type PathParts = { clientId: string; projectId: string; pageId: string };
type Phase = "idle" | "running" | "done" | "failed";

const VERDICT_TONE = {
  holding: "success",
  failing: "error",
  couldnt_verify: "neutral",
} as const;

const VERDICT_LABEL = {
  holding: "Passes",
  failing: "Fails",
  couldnt_verify: "Needs your eyes",
} as const;

export function ChecklistPrefillRunner({
  url,
  items,
  path,
}: {
  url: string | null;
  items: Array<{ id: string; name: string }>;
  path: PathParts;
}) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [note, setNote] = useState<string>("");
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [confirmed, setConfirmed] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const checkedAt = useRef<string>("");

  // Memoised: rebuilding the Map each render would change the identity of both
  // callbacks below on every render, which the hooks lint rightly objects to.
  const idByName = useMemo(
    () => new Map(items.map((i) => [i.name, i.id])),
    [items],
  );

  /** Start a job and poll it to completion. Returns the report, or null. */
  const runJob = useCallback(
    async (action: "pagecheck" | "responsive", view: string): Promise<Record<string, unknown> | null> => {
      const res = await fetch(`/api/linkspy/monitor?action=${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const started = await res.json();
      const id = started?.check_id;
      if (!id) return null;
      // Both runs load the page in a real browser; the sweep does it eight
      // times. Polling beats holding a request open past the proxy's budget.
      for (let i = 0; i < 80; i++) {
        await new Promise((r) => setTimeout(r, 2500));
        const s = await fetch(`/api/linkspy/monitor?view=${view}&id=${encodeURIComponent(id)}`,
          { cache: "no-store" });
        const data = await s.json();
        if (data?.status === "done") return data.report ?? null;
        if (data?.status === "failed" || data?.status === "not_found" || data?.unavailable) return null;
      }
      return null;
    },
    [url],
  );

  const run = useCallback(async () => {
    if (!url) return;
    setPhase("running");
    setProposals([]);
    setConfirmed({});
    setNote("Loading the page in a real browser…");
    try {
      const [capture, sweep] = await Promise.all([
        runJob("pagecheck", "pagecheck"),
        runJob("responsive", "responsive"),
      ]);
      if (!capture && !sweep) {
        setPhase("failed");
        setNote("Neither check completed, so there is nothing to propose.");
        return;
      }
      const found = [
        ...(capture ? proposalsFromPagecheck(toFindings(capture.checks)) : []),
        ...(sweep ? proposalsFromSweep(toFindings(sweep.findings)) : []),
      ];
      // Only propose against rows this certificate actually has.
      const usable = Object.values(byItemName(found)).filter((p) => idByName.has(p.itemName));
      checkedAt.current = new Date().toISOString();
      setProposals(usable);
      setPhase("done");
      setNote(
        usable.length
          ? `${usable.length} checklist row${usable.length > 1 ? "s" : ""} can be answered from this run.`
          : "This run could not answer any checklist row honestly.",
      );
    } catch {
      setPhase("failed");
      setNote("Could not reach the checker.");
    }
  }, [url, runJob, idByName]);

  const confirm = useCallback(
    async (p: Proposal) => {
      const itemId = idByName.get(p.itemName);
      if (!itemId) return;
      setBusy(p.itemName);
      try {
        await confirmMachineItem({
          itemId,
          verdict: p.verdict,
          detail: p.detail,
          checkedAt: checkedAt.current,
          path,
        });
        setConfirmed((c) => ({ ...c, [p.itemName]: true }));
      } finally {
        setBusy(null);
      }
    },
    [idByName, path],
  );

  if (!url || !items.length) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Fill the checklist from a live check</CardTitle>
      </CardHeader>
      <div className="px-5 pb-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <p className="max-w-prose text-[13px] text-text-secondary">
            Opens the page in a real browser and proposes answers for the rows it can
            answer honestly. Nothing is written until you confirm each one, and a row
            it is unsure about is never marked as passing.
          </p>
          <Button onClick={run} disabled={phase === "running"}>
            {phase === "running" ? (
              <>
                <RefreshCw className="size-4 animate-spin" /> Checking…
              </>
            ) : (
              <>
                <ClipboardCheck className="size-4" /> Run check
              </>
            )}
          </Button>
        </div>

        {note && (
          <p className={`mt-3 text-[13px] ${phase === "failed" ? "text-error" : "text-text-muted"}`}>
            {note}
            {phase === "running" && " This takes about two minutes."}
          </p>
        )}

        {proposals.length > 0 && (
          <div className="mt-4 flex flex-col divide-y divide-border-soft border-t border-border-soft">
            {proposals.map((p) => (
              <div key={p.itemName} className="flex flex-wrap items-start justify-between gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <div className="mb-0.5 flex items-center gap-2">
                    <Badge tone={VERDICT_TONE[p.verdict]}>{VERDICT_LABEL[p.verdict]}</Badge>
                    <span className="text-sm font-medium text-text-primary">{p.itemName}</span>
                  </div>
                  <p className="max-w-prose text-[12px] text-text-secondary">{p.detail}</p>
                </div>
                {confirmed[p.itemName] ? (
                  <span className="inline-flex items-center gap-1.5 text-[13px] font-medium text-success">
                    <Check className="size-4" /> Confirmed
                  </span>
                ) : (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => confirm(p)}
                    disabled={busy === p.itemName}
                  >
                    {busy === p.itemName ? "Saving…" : "Confirm"}
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}
