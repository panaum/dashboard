-- Onboarding and rank-change requests. Additive only (ADR-001): two new
-- columns on TeamMember and one new table; nothing dropped or renamed.

-- What the person would rather be called; self-service on /dashboard/profile.
ALTER TABLE "TeamMember" ADD COLUMN "nickname" TEXT;

-- Whether the person has finished (or explicitly skipped) first-run
-- onboarding. Server-side so it follows them across devices.
ALTER TABLE "TeamMember" ADD COLUMN "hasCompletedOnboarding" BOOLEAN NOT NULL DEFAULT false;

-- Backfill: anyone who could already sign in as themselves before this
-- shipped knows the product and must not meet a first-run tour. "Could sign
-- in" is a password on the row: "lastLoginAt" exists but nothing has ever
-- written it, so on its own it would match nobody. Both are checked so the
-- statement stays right if that changes before this runs.
UPDATE "TeamMember" SET "hasCompletedOnboarding" = true
  WHERE "passwordHash" IS NOT NULL OR "lastLoginAt" IS NOT NULL;

-- A request to change rank (in practice VIEWER -> MEMBER). Approving one is
-- rank:assign with this row as the audit trail.
CREATE TABLE "RankChangeRequest" (
    "id" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "fromRank" TEXT NOT NULL,
    "toRank" TEXT NOT NULL,
    "reason" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RankChangeRequest_pkey" PRIMARY KEY ("id")
);

-- The profile page reads a person's latest request; the Team page counts
-- pending ones.
CREATE INDEX "RankChangeRequest_requestedById_createdAt_idx" ON "RankChangeRequest"("requestedById", "createdAt");
CREATE INDEX "RankChangeRequest_status_idx" ON "RankChangeRequest"("status");

-- A request goes with the person who made it; losing the reviewer only
-- blanks the reviewer, never the decision.
ALTER TABLE "RankChangeRequest" ADD CONSTRAINT "RankChangeRequest_requestedById_fkey"
  FOREIGN KEY ("requestedById") REFERENCES "TeamMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RankChangeRequest" ADD CONSTRAINT "RankChangeRequest_reviewedById_fkey"
  FOREIGN KEY ("reviewedById") REFERENCES "TeamMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- REVERSIBILITY: drop table "RankChangeRequest"; drop columns "nickname" and
-- "hasCompletedOnboarding" (the backfill only set the new column).
-- DATA AT RISK: none, additive only.
