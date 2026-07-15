-- AlterTable
ALTER TABLE "Client" ADD COLUMN     "registryClientId" TEXT;

-- AlterTable
ALTER TABLE "Page" ADD COLUMN     "registryDeliverableId" TEXT,
ADD COLUMN     "registrySiteId" TEXT;


-- REVERSIBILITY: additive nullable columns only. Undo (requires an ADR per
--   Constitution rule 1, involves DROPs):
--     ALTER TABLE "Client" DROP COLUMN "registryClientId";
--     ALTER TABLE "Page" DROP COLUMN "registryDeliverableId", DROP COLUMN "registrySiteId";
-- DATA AT RISK: none, additive only. Three NULLABLE columns; no existing column
--   or row is read/altered. Dump: C:\backups\qa-prod-20260716-002322.dump
