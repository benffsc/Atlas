-- MIG_2958: Performance indexes for ops.requests and ops.intake_submissions
-- FFS-651: Missing database indexes causing table scans on 50k+ row tables
--
-- NOTE: No BEGIN/COMMIT wrapper — CREATE INDEX CONCURRENTLY cannot run inside a transaction.

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_requests_status
  ON ops.requests(status);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_requests_is_test
  ON ops.requests(is_test) WHERE is_test = TRUE;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_requests_created_at_status
  ON ops.requests(created_at, status);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_requests_is_archived
  ON ops.requests(is_archived) WHERE is_archived = TRUE;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_intake_submissions_status
  ON ops.intake_submissions(submission_status);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_intake_submissions_triage
  ON ops.intake_submissions(triage_category) WHERE triage_category IS NOT NULL;
