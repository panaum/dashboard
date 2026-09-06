-- Cross-device preview runs per saved page, with a fold JPEG per device for
-- the two most recent runs.
--
-- Additive only, per ADR-001: two NEW tables and foreign keys onto them and
-- onto LayoutSite. Nothing existing is altered, so this is safe to apply while
-- the app serves, and rolling it back is a DROP of tables nothing else references.

-- CreateTable
CREATE TABLE "DevicePreviewRun" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "serviceRunId" TEXT NOT NULL,
    "baselineRunId" TEXT,
    "report" JSONB NOT NULL,
    "worst" TEXT NOT NULL DEFAULT 'PASS',
    "deviceCount" INTEGER NOT NULL DEFAULT 0,
    "errorCount" INTEGER NOT NULL DEFAULT 0,
    "warnCount" INTEGER NOT NULL DEFAULT 0,
    "regressedCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "DevicePreviewRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DevicePreviewShot" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "image" BYTEA NOT NULL,
    "bytes" INTEGER NOT NULL,

    CONSTRAINT "DevicePreviewShot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DevicePreviewRun_serviceRunId_key" ON "DevicePreviewRun"("serviceRunId");

-- CreateIndex
CREATE INDEX "DevicePreviewRun_siteId_checkedAt_idx" ON "DevicePreviewRun"("siteId", "checkedAt");

-- CreateIndex
CREATE INDEX "DevicePreviewShot_runId_idx" ON "DevicePreviewShot"("runId");

-- CreateIndex
CREATE UNIQUE INDEX "DevicePreviewShot_runId_profileId_key" ON "DevicePreviewShot"("runId", "profileId");

-- AddForeignKey
ALTER TABLE "DevicePreviewRun" ADD CONSTRAINT "DevicePreviewRun_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "LayoutSite"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DevicePreviewShot" ADD CONSTRAINT "DevicePreviewShot_runId_fkey" FOREIGN KEY ("runId") REFERENCES "DevicePreviewRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

