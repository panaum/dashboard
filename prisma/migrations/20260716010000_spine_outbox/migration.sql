-- CreateTable
CREATE TABLE "SpineOutbox" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "registryDeliverableId" TEXT,
    "registrySiteId" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deliveredAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SpineOutbox_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SpineOutbox_deliveredAt_idx" ON "SpineOutbox"("deliveredAt");


-- REVERSIBILITY: additive only. Undo (ADR-gated, involves DROP): DROP TABLE "SpineOutbox".
-- DATA AT RISK: none, additive only. One new table + index; no existing table is
--   read or altered. Dump: C:\backups\qa-prod-20260716-013657.dump
