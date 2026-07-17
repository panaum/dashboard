import { Check } from "lucide-react";
import { db } from "@/lib/db";
import { Card } from "@/components/ui/card";
import { CandidateCard, type CandidateView } from "./candidate-card";

export const metadata = { title: "Checklist Candidates" };

// The flywheel's review queue: production incidents with no delivery check,
// awaiting a human decision. Internal/agency, verdict-first, designed empty state.
export default async function CandidatesPage() {
  const rows = await db.checklistCandidate.findMany({
    where: { status: "draft" },
    orderBy: { createdAt: "desc" },
  });

  const candidates: CandidateView[] = rows.map((c) => {
    const ev = (c.evidence ?? {}) as Record<string, unknown>;
    return {
      id: c.id,
      incidentClass: c.incidentClass,
      proposedWording: c.proposedWording,
      machineVerifiable: c.machineVerifiable,
      evidenceSummary: String(ev.evidence_summary ?? `from a resolved ${c.incidentClass} incident`),
      createdAt: c.createdAt.toISOString().slice(0, 10),
    };
  });
  const linkspyBase = process.env.LINKSPY_APP_URL ?? null;

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-xl font-semibold text-text-primary">Checklist Candidates</h1>
        <p className="mt-1 text-sm text-text-secondary">
          {candidates.length > 0
            ? `${candidates.length} candidate${candidates.length === 1 ? "" : "s"} awaiting review`
            : "Production hasn't taught us anything new lately"}
        </p>
      </div>

      {candidates.length === 0 ? (
        <Card className="flex flex-col items-center gap-2 p-10 text-center">
          <span className="flex size-10 items-center justify-center rounded-full bg-success/10 text-success">
            <Check className="size-5" />
          </span>
          <p className="text-sm font-medium text-text-primary">No candidates to review</p>
          <p className="text-[13px] text-text-secondary">
            When a production incident isn&apos;t covered by a delivery check, it appears here for you to promote.
          </p>
        </Card>
      ) : (
        <div className="flex flex-col gap-4">
          {candidates.map((c) => (
            <CandidateCard key={c.id} candidate={c} linkspyBase={linkspyBase} />
          ))}
        </div>
      )}
    </div>
  );
}
