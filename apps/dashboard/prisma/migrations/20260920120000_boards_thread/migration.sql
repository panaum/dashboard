-- Boards: card cover + attachment names, @mentions, Slack ids.
-- Additive only: three nullable-or-defaulted columns and one new table.
-- DATA AT RISK: none. Nothing is dropped, renamed, or rewritten; existing
-- images get filename NULL and isCover false; existing members get
-- slackUserId NULL.

ALTER TABLE "IssueImage" ADD COLUMN "filename" TEXT;
ALTER TABLE "IssueImage" ADD COLUMN "isCover" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "TeamMember" ADD COLUMN "slackUserId" TEXT;

CREATE TABLE "IssueMention" (
    "id" TEXT NOT NULL,
    "commentId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "notifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "IssueMention_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "IssueMention_commentId_memberId_key" ON "IssueMention"("commentId", "memberId");
CREATE INDEX "IssueMention_memberId_notifiedAt_idx" ON "IssueMention"("memberId", "notifiedAt");
ALTER TABLE "IssueMention" ADD CONSTRAINT "IssueMention_commentId_fkey" FOREIGN KEY ("commentId") REFERENCES "IssueComment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "IssueMention" ADD CONSTRAINT "IssueMention_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "TeamMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;
