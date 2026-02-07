-- ============================================================================
-- MIG_918: Fix web_intake_submissions Missing Columns (DATA_GAP_013)
-- ============================================================================
-- Problem: source_system and handleability columns were defined in MIG_237
--          interface but never applied to the actual database table.
--          This breaks the intake form submission.
--
-- Solution: Add the missing columns to unblock intake form.
--
-- Related: DATA_GAP_013 (Identity Resolution Consolidation)
-- ============================================================================

\echo '=== MIG_918: Fix web_intake_submissions Missing Columns ==='
\echo ''

-- ============================================================================
-- Phase 1: Add missing columns
-- ============================================================================

\echo 'Phase 1: Adding missing columns...'

-- Add source_system column for tracking intake source type
ALTER TABLE trapper.web_intake_submissions
ADD COLUMN IF NOT EXISTS source_system TEXT;

COMMENT ON COLUMN trapper.web_intake_submissions.source_system IS
'Specific source system (web_intake_receptionist, jotform_public, etc.)';

-- Add handleability column for cat handling assessment
ALTER TABLE trapper.web_intake_submissions
ADD COLUMN IF NOT EXISTS handleability TEXT;

COMMENT ON COLUMN trapper.web_intake_submissions.handleability IS
'Cat handleability: friendly_carrier, shy_handleable, unhandleable_trap, unknown, some_friendly, all_unhandleable';

-- ============================================================================
-- Phase 2: Verify columns exist
-- ============================================================================

\echo ''
\echo 'Phase 2: Verifying columns...'

SELECT 'Columns added:' as info;
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'trapper'
  AND table_name = 'web_intake_submissions'
  AND column_name IN ('source_system', 'handleability')
ORDER BY column_name;

-- ============================================================================
-- Summary
-- ============================================================================

\echo ''
\echo '=============================================='
\echo 'MIG_918 Complete!'
\echo '=============================================='
\echo ''
\echo 'Changes made:'
\echo '  1. Added source_system column (TEXT)'
\echo '  2. Added handleability column (TEXT)'
\echo ''
\echo 'DATA_GAP_013: Intake form columns - FIXED'
\echo ''
\echo 'Next: MIG_919 (Data Engine consolidated gate)'
\echo ''
