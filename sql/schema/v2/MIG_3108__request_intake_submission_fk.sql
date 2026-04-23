-- MIG_3108: Add FK from requests back to intake submissions (FFS-1351)
--
-- Problem: No link from request back to its source intake submission.
-- Custom fields, triage scores, contact attempts are lost during conversion.
--
-- Solution: Add intake_submission_id column with FK + backfill existing.

BEGIN;

-- Add column
ALTER TABLE ops.requests ADD COLUMN IF NOT EXISTS intake_submission_id UUID
  REFERENCES ops.intake_submissions(submission_id);

-- Index for lookups (partial — most requests won't have this set)
CREATE INDEX IF NOT EXISTS idx_requests_intake_submission
  ON ops.requests(intake_submission_id)
  WHERE intake_submission_id IS NOT NULL;

-- Backfill: match existing converted requests to their intake submissions
-- ops.intake_submissions has a request_id column set during conversion
UPDATE ops.requests r
SET intake_submission_id = s.submission_id
FROM ops.intake_submissions s
WHERE s.request_id = r.request_id
  AND r.intake_submission_id IS NULL;

COMMIT;
