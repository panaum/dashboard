"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { motion } from "motion/react";
import { Sparkles } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/field";
import {
  CHECK_TONE,
  SEVERITY_TONE,
  label,
  type CheckResult,
  type Severity,
} from "@/lib/constants";
import {
  analyzeUrl,
  applyProposal,
} from "@/app/dashboard/clients/[clientId]/[projectId]/[pageId]/actions";

type Path = { clientId: string; projectId: string; pageId: string };
type Proposal = {
  ok: boolean;
  error?: string;
  aiUsed: boolean;
  finalUrl?: string;
  checks: { name: string; result: string; valueDesktop?: string | null; note: string }[];
  issues: { title: string; severity: string }[];
};

function Flow({
  certId,
  pageId,
  defaultUrl,
  path,
  close,
}: {
  certId: string;
  pageId: string;
  defaultUrl: string;
  path: Path;
  close: () => void;
}) {
  const router = useRouter();
  const [url, setUrl] = React.useState(defaultUrl);
  const [loading, setLoading] = React.useState(false);
  const [applying, setApplying] = React.useState(false);
  const [proposal, setProposal] = React.useState<Proposal | null>(null);

  async function analyze() {
    setLoading(true);
    setProposal(null);
    const p = await analyzeUrl(url);
    setProposal(p);
    setLoading(false);
  }

  async function apply() {
    if (!proposal) return;
    setApplying(true);
    await applyProposal({
      certId,
      pageId,
      path,
      checks: proposal.checks.map((c) => ({
        name: c.name,
        result: c.result,
        valueDesktop: c.valueDesktop ?? null,
      })),
      issues: proposal.issues,
    });
    router.refresh();
    close();
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-2">
        <Input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://…"
          autoFocus
        />
        <Button onClick={analyze} disabled={loading || !url}>
          {loading ? "Analysing…" : "Analyse"}
        </Button>
      </div>

      {loading && (
        <p className="text-[13px] text-text-secondary">
          Fetching the page and running checks…
        </p>
      )}

      {proposal && !proposal.ok && (
        <p className="text-[13px] text-error">{proposal.error}</p>
      )}

      {proposal?.ok && (
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex max-h-[55vh] flex-col gap-4 overflow-y-auto"
        >
          <Badge tone={proposal.aiUsed ? "success" : "warning"}>
            {proposal.aiUsed
              ? "AI judgment applied"
              : "Deterministic checks only (no API key)"}
          </Badge>

          <div>
            <p className="mb-2 text-[13px] font-semibold text-text-primary">
              Checklist results ({proposal.checks.length})
            </p>
            <div className="flex flex-col divide-y divide-border-soft rounded-md border border-border-soft">
              {proposal.checks.map((c) => (
                <div
                  key={c.name}
                  className="flex items-center justify-between gap-3 px-3 py-2"
                >
                  <div className="flex flex-col">
                    <span className="text-[13px] text-text-primary">{c.name}</span>
                    <span className="text-xs text-text-muted">{c.note}</span>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {c.valueDesktop && (
                      <span className="text-xs font-medium text-text-secondary">
                        {c.valueDesktop}
                      </span>
                    )}
                    <Badge tone={CHECK_TONE[c.result as CheckResult]}>
                      {label(c.result)}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div>
            <p className="mb-2 text-[13px] font-semibold text-text-primary">
              Suggested issues ({proposal.issues.length})
            </p>
            {proposal.issues.length === 0 ? (
              <p className="text-xs text-text-muted">None flagged.</p>
            ) : (
              <div className="flex flex-col gap-1.5">
                {proposal.issues.map((i, idx) => (
                  <div
                    key={idx}
                    className="flex items-center justify-between gap-3 rounded-md bg-card-soft px-3 py-2"
                  >
                    <span className="text-[13px] text-text-primary">{i.title}</span>
                    <Badge tone={SEVERITY_TONE[i.severity as Severity] ?? "neutral"}>
                      {label(i.severity)}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="flex justify-end gap-2 border-t border-border-soft pt-3">
            <Button variant="ghost" onClick={close}>
              Cancel
            </Button>
            <Button onClick={apply} disabled={applying}>
              {applying
                ? "Applying…"
                : `Apply to checklist${proposal.issues.length ? " + log issues" : ""}`}
            </Button>
          </div>
        </motion.div>
      )}
    </div>
  );
}

export function AiQaButton({
  certId,
  pageId,
  defaultUrl,
  path,
}: {
  certId: string;
  pageId: string;
  defaultUrl: string;
  path: Path;
}) {
  return (
    <Dialog
      title="AI QA agent"
      size="lg"
      trigger={
        <Button variant="secondary" size="sm">
          <Sparkles /> Run AI QA
        </Button>
      }
    >
      {(close) => (
        <Flow
          certId={certId}
          pageId={pageId}
          defaultUrl={defaultUrl}
          path={path}
          close={close}
        />
      )}
    </Dialog>
  );
}
