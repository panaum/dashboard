-- Team member profile: a designation and a photo.
-- Additive only: four nullable columns on TeamMember.
-- DATA AT RISK: none. Every existing member gets NULL in all four and keeps
-- their initials avatar.

ALTER TABLE "TeamMember" ADD COLUMN "title" TEXT;
ALTER TABLE "TeamMember" ADD COLUMN "avatar" BYTEA;
ALTER TABLE "TeamMember" ADD COLUMN "avatarType" TEXT;
ALTER TABLE "TeamMember" ADD COLUMN "avatarUpdatedAt" TIMESTAMP(3);
