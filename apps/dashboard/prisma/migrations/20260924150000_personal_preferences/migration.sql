-- Personal preferences on TeamMember. Additive only (ADR-001): four new
-- columns, each defaulted so existing rows behave exactly as before.

-- Slack pings a person receives. On by default — today everyone gets them.
ALTER TABLE "TeamMember" ADD COLUMN "notifyMentions" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "TeamMember" ADD COLUMN "notifyReplies" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "TeamMember" ADD COLUMN "notifyDueReminders" BOOLEAN NOT NULL DEFAULT true;

-- Their time zone (IANA name). NULL = follow the browser, the current behaviour.
ALTER TABLE "TeamMember" ADD COLUMN "timeZone" TEXT;

-- REVERSIBILITY: drop the four columns.
-- DATA AT RISK: none, additive only.
