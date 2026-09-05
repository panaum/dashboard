-- Saved pages for layout checking, and the history of each sweep.
--
-- Additive only, per ADR-001: two NEW tables and one foreign key onto them.
-- Nothing existing is altered, so this is safe to apply while the app serves,
-- and rolling it back is a DROP of tables nothing else references.

CREATE TABLE "LayoutSite" (
    "id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "label" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LayoutSite_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LayoutRun" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "findings" JSONB NOT NULL,
    "worst" TEXT NOT NULL DEFAULT 'PASS',
    "failCount" INTEGER NOT NULL DEFAULT 0,
    "warnCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "LayoutRun_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LayoutSite_url_key" ON "LayoutSite"("url");
CREATE INDEX "LayoutRun_siteId_checkedAt_idx" ON "LayoutRun"("siteId", "checkedAt");

ALTER TABLE "LayoutRun" ADD CONSTRAINT "LayoutRun_siteId_fkey"
    FOREIGN KEY ("siteId") REFERENCES "LayoutSite"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Screenshots for the two most recent runs of each site. Pruning is done by the
-- application after each run, not by a database job, so the rule lives next to
-- the code that knows what a "run" means.
CREATE TABLE "LayoutShot" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "width" INTEGER NOT NULL,
    "image" BYTEA NOT NULL,
    "bytes" INTEGER NOT NULL,

    CONSTRAINT "LayoutShot_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LayoutShot_runId_width_key" ON "LayoutShot"("runId", "width");
CREATE INDEX "LayoutShot_runId_idx" ON "LayoutShot"("runId");

ALTER TABLE "LayoutShot" ADD CONSTRAINT "LayoutShot_runId_fkey"
    FOREIGN KEY ("runId") REFERENCES "LayoutRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
