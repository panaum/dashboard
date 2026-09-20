-- Boards: QA ↔ developer issue tracking, built on the existing Issue table.
--
-- Additive only, per ADR-001: every new column is nullable or defaulted, so
-- every existing row stays valid and this is safe to apply while the app is
-- serving. Nothing is dropped, renamed or retyped. Existing issues get
-- boardStage NULL — they predate boards and are not on one.
--
-- The board is the Project. Project.boardShareId is the developer capability
-- link, the same mechanism as Page.shareId: a random token on the row, NULL
-- to revoke. There is no CapabilityLink table in this schema to extend.
--
-- DATA AT RISK: none, additive only.

-- Project: the developer capability link.
ALTER TABLE "Project" ADD COLUMN "boardShareId" TEXT;
CREATE UNIQUE INDEX "Project_boardShareId_key" ON "Project"("boardShareId");

-- Issue: board fields beside the untouched review fields.
ALTER TABLE "Issue" ADD COLUMN "boardStage" TEXT;
ALTER TABLE "Issue" ADD COLUMN "boardOrder" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Issue" ADD COLUMN "link" TEXT;
ALTER TABLE "Issue" ADD COLUMN "recurring" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Issue" ADD COLUMN "assigneeId" TEXT;
ALTER TABLE "Issue" ADD COLUMN "reporterId" TEXT;
CREATE INDEX "Issue_assigneeId_idx" ON "Issue"("assigneeId");
CREATE INDEX "Issue_boardStage_idx" ON "Issue"("boardStage");
ALTER TABLE "Issue" ADD CONSTRAINT "Issue_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "TeamMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Issue" ADD CONSTRAINT "Issue_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "TeamMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- IssueEvent: one row per stage change. Every metric is computed from here.
CREATE TABLE "IssueEvent" (
    "id" TEXT NOT NULL,
    "issueId" TEXT NOT NULL,
    "fromStage" TEXT,
    "toStage" TEXT NOT NULL,
    "actorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "IssueEvent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "IssueEvent_issueId_createdAt_idx" ON "IssueEvent"("issueId", "createdAt");
CREATE INDEX "IssueEvent_actorId_createdAt_idx" ON "IssueEvent"("actorId", "createdAt");
ALTER TABLE "IssueEvent" ADD CONSTRAINT "IssueEvent_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "Issue"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "IssueEvent" ADD CONSTRAINT "IssueEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "TeamMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- IssueComment: the thread on a card, so clarification happens in place.
CREATE TABLE "IssueComment" (
    "id" TEXT NOT NULL,
    "issueId" TEXT NOT NULL,
    "authorId" TEXT,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "IssueComment_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "IssueComment_issueId_createdAt_idx" ON "IssueComment"("issueId", "createdAt");
ALTER TABLE "IssueComment" ADD CONSTRAINT "IssueComment_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "Issue"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "IssueComment" ADD CONSTRAINT "IssueComment_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "TeamMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- IssueImage: screenshots as bytes, like LayoutShot. No object store on the
-- free tier, and the evidence stays in the same database as the card.
CREATE TABLE "IssueImage" (
    "id" TEXT NOT NULL,
    "issueId" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "image" BYTEA NOT NULL,
    "bytes" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "IssueImage_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "IssueImage_issueId_idx" ON "IssueImage"("issueId");
ALTER TABLE "IssueImage" ADD CONSTRAINT "IssueImage_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "Issue"("id") ON DELETE CASCADE ON UPDATE CASCADE;
