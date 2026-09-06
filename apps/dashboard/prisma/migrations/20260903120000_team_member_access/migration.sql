-- Per-person login and access rank on TeamMember.
--
-- Additive only, per ADR-001: every column is nullable or defaulted, so every
-- existing row stays valid and this is safe to apply while the app is serving.
-- Nothing is dropped, renamed or retyped.
--
-- `rank` defaults to MEMBER, so applying this grants nobody new power — the
-- first admin is promoted deliberately, by an UPDATE, after the deploy.

ALTER TABLE "TeamMember" ADD COLUMN "rank" TEXT NOT NULL DEFAULT 'MEMBER';
ALTER TABLE "TeamMember" ADD COLUMN "email" TEXT;
ALTER TABLE "TeamMember" ADD COLUMN "passwordHash" TEXT;
ALTER TABLE "TeamMember" ADD COLUMN "lastLoginAt" TIMESTAMP(3);

-- Partial-free unique index: Postgres treats NULLs as distinct, so many members
-- may have no email while any set email must be unique.
CREATE UNIQUE INDEX "TeamMember_email_key" ON "TeamMember"("email");
