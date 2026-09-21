-- Boards "feels alive": unread state, presence, and a per-board accent.
-- Additive only: one nullable column on Project and two new tables.
-- DATA AT RISK: none. Every existing project keeps the default accent (NULL),
-- every card starts unread for everyone (no IssueView rows), and presence is
-- empty until someone opens a board.

ALTER TABLE "Project" ADD COLUMN "accentColor" TEXT;

CREATE TABLE "IssueView" (
    "id" TEXT NOT NULL,
    "issueId" TEXT NOT NULL,
    "viewerId" TEXT NOT NULL,
    "viewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "IssueView_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "IssueView_issueId_viewerId_key" ON "IssueView"("issueId", "viewerId");
CREATE INDEX "IssueView_viewerId_idx" ON "IssueView"("viewerId");
ALTER TABLE "IssueView" ADD CONSTRAINT "IssueView_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "Issue"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "IssueView" ADD CONSTRAINT "IssueView_viewerId_fkey" FOREIGN KEY ("viewerId") REFERENCES "TeamMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "BoardPresence" (
    "memberId" TEXT NOT NULL,
    "projectId" TEXT,
    "seenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "typingIssueId" TEXT,
    "typingAt" TIMESTAMP(3),
    CONSTRAINT "BoardPresence_pkey" PRIMARY KEY ("memberId")
);
CREATE INDEX "BoardPresence_projectId_seenAt_idx" ON "BoardPresence"("projectId", "seenAt");
ALTER TABLE "BoardPresence" ADD CONSTRAINT "BoardPresence_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "TeamMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;
