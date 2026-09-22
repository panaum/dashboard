-- Why a card moved, when the move needs a why.
--
-- Moving a card into "Discussed" now requires a reason, and the reason belongs
-- on the transition rather than loose in the comment thread: it cannot drift
-- from the move that prompted it, and it cannot be deleted independently.
-- Nullable and additive — every existing event keeps working (ADR-001).
ALTER TABLE "IssueEvent" ADD COLUMN "note" TEXT;
