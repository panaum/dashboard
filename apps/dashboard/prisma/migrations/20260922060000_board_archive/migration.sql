-- Archiving a board is a flag and nothing else: one nullable timestamp on the
-- project. Every card, comment, screenshot, event and assignee stays exactly
-- where it is, and unarchiving is setting this back to NULL. Additive only —
-- no column is dropped, no data is rewritten (ADR-001).
ALTER TABLE "Project" ADD COLUMN "boardArchivedAt" TIMESTAMP(3);

-- Who put it away, so an archived board is attributable like every other
-- board action. SET NULL rather than CASCADE: losing the person must never
-- take the archive state with it.
ALTER TABLE "Project" ADD COLUMN "boardArchivedById" TEXT;
ALTER TABLE "Project" ADD CONSTRAINT "Project_boardArchivedById_fkey"
  FOREIGN KEY ("boardArchivedById") REFERENCES "TeamMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- The boards index filters on this on every load.
CREATE INDEX "Project_boardArchivedAt_idx" ON "Project"("boardArchivedAt");
