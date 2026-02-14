-- MIG_294: Intake Queue Cleanup and Auto-Archival
--
-- Reduces clutter in the intake queue by:
-- 1. Auto-archiving old legacy submissions that were never actioned
-- 2. Creating function for periodic cleanup of stale submissions
-- 3. Adding index for faster queue queries
--
-- MANUAL APPLY:
--   source .env && psql "$DATABASE_URL" -f sql/schema/sot/MIG_294__intake_queue_cleanup.sql

\echo ''
\echo 'MIG_294: Intake Queue Cleanup and Auto-Archival'
\echo '================================================'
\echo ''

-- 1. Archive old legacy submissions that are still 'new' or 'in_progress'
-- These are legacy items from before Dec 2025 that were never properly handled
\echo 'Archiving old legacy submissions (before Dec 2025) that are still actionable...'

UPDATE trapper.web_intake_submissions
SET
  submission_status = 'archived'::trapper.intake_submission_status,
  review_notes = COALESCE(review_notes || E'\n', '') ||
    '[Auto-archived: Legacy submission from before Dec 2025 that was not actioned]',
  updated_at = NOW()
WHERE is_legacy = TRUE
  AND submitted_at < '2025-12-01'
  AND submission_status IN ('new', 'in_progress')
  AND created_request_id IS NULL;

\echo 'Old legacy submissions archived'

-- 2. Create function for periodic archival of completed submissions
\echo 'Creating archive_old_completed_submissions function...'

CREATE OR REPLACE FUNCTION trapper.archive_old_completed_submissions(
  p_days_old INT DEFAULT 90
)
RETURNS INT AS $$
DECLARE
  v_count INT;
BEGIN
  UPDATE trapper.web_intake_submissions
  SET
    submission_status = 'archived'::trapper.intake_submission_status,
    review_notes = COALESCE(review_notes || E'\n', '') ||
      '[Auto-archived: Completed submission older than ' || p_days_old || ' days]',
    updated_at = NOW()
  WHERE submission_status = 'complete'
    AND updated_at < NOW() - (p_days_old || ' days')::INTERVAL
    AND is_test = FALSE;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.archive_old_completed_submissions IS
'Archives completed submissions older than N days (default 90). Run periodically to keep queue clean.';

-- 3. Create function to archive stale in_progress submissions
\echo 'Creating archive_stale_submissions function...'

CREATE OR REPLACE FUNCTION trapper.archive_stale_submissions(
  p_days_stale INT DEFAULT 60
)
RETURNS INT AS $$
DECLARE
  v_count INT;
BEGIN
  -- Archive submissions that have been 'in_progress' for too long without activity
  UPDATE trapper.web_intake_submissions
  SET
    submission_status = 'archived'::trapper.intake_submission_status,
    review_notes = COALESCE(review_notes || E'\n', '') ||
      '[Auto-archived: No activity for ' || p_days_stale || '+ days]',
    updated_at = NOW()
  WHERE submission_status = 'in_progress'
    AND COALESCE(last_contacted_at, updated_at, submitted_at) < NOW() - (p_days_stale || ' days')::INTERVAL
    AND created_request_id IS NULL
    AND is_test = FALSE;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.archive_stale_submissions IS
'Archives in_progress submissions with no activity for N days (default 60). Run periodically.';

-- 4. Create combined cleanup function
\echo 'Creating run_intake_cleanup function...'

CREATE OR REPLACE FUNCTION trapper.run_intake_cleanup()
RETURNS TABLE (
  cleanup_type TEXT,
  count INT
) AS $$
DECLARE
  v_completed INT;
  v_stale INT;
BEGIN
  -- Archive old completed submissions (90 days)
  SELECT trapper.archive_old_completed_submissions(90) INTO v_completed;

  -- Archive stale in_progress submissions (60 days)
  SELECT trapper.archive_stale_submissions(60) INTO v_stale;

  RETURN QUERY VALUES
    ('completed_archived', v_completed),
    ('stale_archived', v_stale);
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.run_intake_cleanup IS
'Runs all intake cleanup operations. Call periodically (e.g., monthly) to keep queue clean.';

-- 5. Add index for faster queue queries by status and date
\echo 'Adding indexes for faster queue queries...'

CREATE INDEX IF NOT EXISTS idx_intake_submission_status_date
  ON trapper.web_intake_submissions(submission_status, submitted_at DESC)
  WHERE submission_status != 'archived';

CREATE INDEX IF NOT EXISTS idx_intake_is_legacy_status
  ON trapper.web_intake_submissions(is_legacy, submission_status)
  WHERE is_legacy = TRUE;

-- 6. Add index for test submissions filtering
CREATE INDEX IF NOT EXISTS idx_intake_is_test
  ON trapper.web_intake_submissions(is_test)
  WHERE is_test = TRUE;

-- 7. Update view to include is_test more prominently for UI badge
\echo 'Queue view already has is_test field - no view changes needed'

-- 8. Summary stats
\echo ''
\echo 'Current queue statistics:'
SELECT
  submission_status::TEXT AS status,
  is_legacy,
  COUNT(*) AS count
FROM trapper.web_intake_submissions
WHERE submission_status != 'archived'
GROUP BY submission_status, is_legacy
ORDER BY is_legacy, submission_status;

\echo ''
\echo 'MIG_294 complete!'
\echo ''
\echo 'New functions:'
\echo '  - archive_old_completed_submissions(days) - Archives completed items older than N days'
\echo '  - archive_stale_submissions(days) - Archives in_progress items with no activity'
\echo '  - run_intake_cleanup() - Runs all cleanup operations'
\echo ''
\echo 'Run SELECT * FROM trapper.run_intake_cleanup(); periodically to keep queue clean'
\echo ''
