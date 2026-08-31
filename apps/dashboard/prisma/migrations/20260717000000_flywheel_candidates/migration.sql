-- AlterTable
ALTER TABLE "ChecklistTemplateItem" ADD COLUMN     "origin" TEXT,
ADD COLUMN     "originAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "ChecklistCandidate" (
    "id" TEXT NOT NULL,
    "linkspyCandidateRef" TEXT NOT NULL,
    "incidentClass" TEXT NOT NULL,
    "proposedWording" TEXT NOT NULL,
    "evidence" JSONB NOT NULL,
    "machineVerifiable" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "rationale" TEXT,
    "reason" TEXT,
    "decidedBy" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChecklistCandidate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ChecklistCandidate_linkspyCandidateRef_key" ON "ChecklistCandidate"("linkspyCandidateRef");

-- CreateIndex
CREATE INDEX "ChecklistCandidate_status_idx" ON "ChecklistCandidate"("status");


-- REVERSIBILITY: additive only. Undo (requires an ADR per rule 1 — involves DROPs):
--   DROP TABLE "ChecklistCandidate";
--   ALTER TABLE "ChecklistTemplateItem" DROP COLUMN "origin", DROP COLUMN "originAt";
-- DATA AT RISK: none, additive only. One new table + two NULLABLE columns; no
--   existing column/row is read or altered. Dump: C:\backups\qa-prod-20260717-163657.dump
