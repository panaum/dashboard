-- AlterTable
ALTER TABLE "QACheckItem" ADD COLUMN     "confirmedAt" TIMESTAMP(3),
ADD COLUMN     "confirmedBy" TEXT,
ADD COLUMN     "confirmedSource" TEXT,
ADD COLUMN     "machineCheckedAt" TIMESTAMP(3),
ADD COLUMN     "machineDetail" TEXT,
ADD COLUMN     "machineVerdict" TEXT;


-- REVERSIBILITY: additive nullable columns only. Undo (ADR-gated, DROPs):
--   ALTER TABLE "QACheckItem" DROP COLUMN "machineVerdict", DROP COLUMN "machineDetail",
--     DROP COLUMN "machineCheckedAt", DROP COLUMN "confirmedSource",
--     DROP COLUMN "confirmedBy", DROP COLUMN "confirmedAt";
-- DATA AT RISK: none, additive only. Six NULLABLE columns; no existing column or
--   row is read/altered. These are written ONLY by the human-confirm action (T4).
--   Dump (session): C:\backups\qa-prod-20260716-013657.dump
