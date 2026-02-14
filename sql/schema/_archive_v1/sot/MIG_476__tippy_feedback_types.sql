-- =====================================================
-- MIG_476: Expand Tippy Feedback Types
-- =====================================================
-- Adds new feedback types for missing data and missing capabilities
-- to help analyze where Tippy/Atlas needs improvement
-- =====================================================

\echo '=========================================='
\echo 'MIG_476: Tippy Feedback Types Expansion'
\echo '=========================================='

-- Update the check constraint to include new feedback types
ALTER TABLE trapper.tippy_feedback
  DROP CONSTRAINT IF EXISTS tippy_feedback_feedback_type_check;

ALTER TABLE trapper.tippy_feedback
  ADD CONSTRAINT tippy_feedback_feedback_type_check CHECK (feedback_type IN (
    'incorrect_count',      -- Wrong number of cats, etc.
    'incorrect_status',     -- Wrong alteration status, request status
    'incorrect_location',   -- Wrong address, place association
    'incorrect_person',     -- Wrong person linked
    'outdated_info',        -- Info was correct but is now stale
    'missing_data',         -- Data exists but Tippy couldn't find it
    'missing_capability',   -- Feature request - Tippy should be able to do this
    'other'                 -- General feedback
  ));

COMMENT ON COLUMN trapper.tippy_feedback.feedback_type IS
  'Category of feedback: incorrect_count, incorrect_status, incorrect_location, incorrect_person, outdated_info, missing_data, missing_capability, other';

\echo ''
\echo 'Added feedback types:'
\echo '  - missing_data: When Tippy could not find existing data'
\echo '  - missing_capability: Feature requests for Tippy'
\echo ''
\echo 'MIG_476 complete'
\echo '=========================================='
