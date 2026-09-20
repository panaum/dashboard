-- Boards: start and due dates on a card, with a reminder.
-- Additive only: four nullable columns and one index on Issue.
-- DATA AT RISK: none. Every existing issue gets NULL in all four.

ALTER TABLE "Issue" ADD COLUMN "startAt" TIMESTAMP(3);
ALTER TABLE "Issue" ADD COLUMN "dueAt" TIMESTAMP(3);
ALTER TABLE "Issue" ADD COLUMN "dueReminderMinutes" INTEGER;
ALTER TABLE "Issue" ADD COLUMN "dueRemindedAt" TIMESTAMP(3);
CREATE INDEX "Issue_dueAt_idx" ON "Issue"("dueAt");
