-- Boards: who minted the developer link, and when.
-- Additive only: two nullable columns on Project and one foreign key.
-- DATA AT RISK: none. Existing links keep working; both columns start NULL.

ALTER TABLE "Project" ADD COLUMN "boardShareCreatedById" TEXT;
ALTER TABLE "Project" ADD COLUMN "boardShareCreatedAt" TIMESTAMP(3);
ALTER TABLE "Project" ADD CONSTRAINT "Project_boardShareCreatedById_fkey" FOREIGN KEY ("boardShareCreatedById") REFERENCES "TeamMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;
