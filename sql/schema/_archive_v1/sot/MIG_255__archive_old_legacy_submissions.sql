-- MIG_255: Archive old legacy appointment requests
--
-- Problem: Legacy submissions from before December 2025 that are still showing
-- as "new" or "in_progress" were likely buried by new submissions and never
-- acted upon. They clutter the "needs attention" views.
--
-- Solution: Mark them as "archived" so they:
--   - Don't show in "needs attention" tabs
--   - Remain searchable in "all submissions"
--   - Have a clear status indicating they were not actioned
--
-- MANUAL APPLY:
--   source .env && psql "$DATABASE_URL" -f sql/schema/sot/MIG_255__archive_old_legacy_submissions.sql

\echo ''
\echo 'MIG_255: Archive old legacy submissions'
\echo '======================================='
\echo ''

-- Count before update
\echo 'Legacy submissions before December 2025 with actionable status:'
SELECT
  submission_status,
  COUNT(*) as count
FROM trapper.web_intake_submissions
WHERE is_legacy = TRUE
  AND submitted_at < '2025-12-01'
  AND submission_status IN ('new', 'in_progress')
GROUP BY submission_status
ORDER BY submission_status;

-- Archive old legacy submissions that are still new or in_progress
-- These were never acted upon and shouldn't require attention anymore
UPDATE trapper.web_intake_submissions
SET
  submission_status = 'archived',
  review_notes = COALESCE(review_notes || E'\n', '') || '[Auto-archived: Legacy submission from before Dec 2025 that was not actioned]',
  updated_at = NOW()
WHERE is_legacy = TRUE
  AND submitted_at < '2025-12-01'
  AND submission_status IN ('new', 'in_progress');

\echo ''
\echo 'Archived legacy submissions. New counts:'
SELECT
  submission_status,
  COUNT(*) as count
FROM trapper.web_intake_submissions
WHERE is_legacy = TRUE
GROUP BY submission_status
ORDER BY submission_status;

\echo ''
\echo 'MIG_255 complete!'
\echo '  - Old legacy submissions (before Dec 2025) marked as archived'
\echo '  - They remain searchable in "all submissions" tab'
\echo '  - Review notes updated to indicate auto-archival'
\echo ''
