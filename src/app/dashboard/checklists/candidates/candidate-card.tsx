"use client";

import { useState, useTransition } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ExternalLink, Cpu } from "lucide-react";
import { promoteCandidate, dismissCandidate } from "./actions";

export type CandidateView = {
  id: string;
  incidentClass: string;
  proposedWording: string;
  machineVerifiable: boolean;
  evidenceSummary: string;
  createdAt: string;
};

export function CandidateCard({ candidate, linkspyBase }: { candidate: CandidateView; linkspyBase: string | null }) {
  const [wording, setWording] = useState(candidate.proposedWording);
  const [rationale, setRationale] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const promote = () => {
    setError(null);
    start(async () => {
      const r = await promoteCandidate({ candidateId: candidate.id, wording, rationale });
      if (r?.error) setError(r.error);
    });
  };
  const dismiss = () => {
    setError(null);
    start(async () => {
      const r = await dismissCandidate({ candidateId: candidate.id, reason });
      if (r?.error) setError(r.error);
    });
  };

  return (
    <Card className="flex flex-col gap-3 p-5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-card-soft px-2.5 py-1 text-xs font-medium text-text-secondary">
          {candidate.incidentClass}
        </span>
        {candidate.machineVerifiable && (
          <span className="inline-flex items-center gap-1 rounded-full bg-accent/10 px-2.5 py-1 text-xs font-medium text-accent">
            <Cpu className="size-3" /> machine-verifiable
          </span>
        )}
        <span className="text-xs text-text-muted tabular-nums">{candidate.createdAt}</span>
      </div>

      <label className="text-[13px] font-medium text-text-secondary">
        Proposed wording (editable before promotion)
        <textarea
          value={wording}
          onChange={(e) => setWording(e.target.value)}
          rows={2}
          className="mt-1 w-full rounded-md border border-border-soft bg-card px-3 py-2 text-sm text-text-primary outline-none focus:border-accent"
        />
      </label>

      <p className="text-[13px] text-text-secondary">
        {candidate.evidenceSummary}
        {linkspyBase && (
          <a href={linkspyBase} target="_blank" rel="noreferrer"
             className="ml-2 inline-flex items-center gap-1 text-accent underline underline-offset-2">
            evidence <ExternalLink className="size-3" />
          </a>
        )}
      </p>

      <div className="flex flex-col gap-2 border-t border-border-soft pt-3">
        <input
          value={rationale}
          onChange={(e) => setRationale(e.target.value)}
          placeholder="Why promote this? (one sentence — required)"
          className="w-full rounded-md border border-border-soft bg-card px-3 py-2 text-sm text-text-primary outline-none focus:border-accent"
        />
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={promote} disabled={pending || !rationale.trim()}>
            {pending ? "Working…" : "Promote"}
          </Button>
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Dismiss reason (optional)"
            className="min-w-40 flex-1 rounded-md border border-border-soft bg-card px-3 py-1.5 text-[13px] text-text-secondary outline-none"
          />
          <Button variant="secondary" onClick={dismiss} disabled={pending}>Dismiss</Button>
        </div>
        {error && <p className="text-[13px] text-error">{error}</p>}
      </div>
    </Card>
  );
}
