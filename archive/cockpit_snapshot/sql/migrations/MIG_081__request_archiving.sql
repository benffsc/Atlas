-- MIG_081__request_archiving.sql
-- Archive support for requests (duplicates/denied/referred) + optional merge pointer.
-- Idempotent: safe to run even if columns/indexes already exist.

BEGIN;

ALTER TABLE trapper.requests
  ADD COLUMN IF NOT EXISTS archived_at timestamptz;

ALTER TABLE trapper.requests
  ADD COLUMN IF NOT EXISTS archive_reason text;

ALTER TABLE trapper.requests
  ADD COLUMN IF NOT EXISTS merged_into_case_number text;

CREATE INDEX IF NOT EXISTS idx_requests_archived_at
  ON trapper.requests(archived_at)
  WHERE archived_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_requests_archive_reason
  ON trapper.requests(archive_reason)
  WHERE archive_reason IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_requests_merged_into_case_number
  ON trapper.requests(merged_into_case_number)
  WHERE merged_into_case_number IS NOT NULL;

COMMENT ON COLUMN trapper.requests.archived_at IS
  'When the request was archived (e.g., marked duplicate/denied/referred).';

COMMENT ON COLUMN trapper.requests.archive_reason IS
  'Why archived. Suggested values: duplicate, denied, referred_elsewhere, other.';

COMMENT ON COLUMN trapper.requests.merged_into_case_number IS
  'If this request was merged into another canonical request, store that case_number here.';

COMMIT;
