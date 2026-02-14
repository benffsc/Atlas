-- MIG_610: Add not_assessing_reason column for kitten assessment
--
-- Purpose: When staff mark a kitten situation as "Not Assessing", they can
-- now provide a reason (e.g., "Older kittens 6+ months - no capacity").
-- This helps track why certain kittens aren't being evaluated for foster.

\echo ''
\echo '=============================================='
\echo 'MIG_610: Kitten Not Assessing Reason'
\echo '=============================================='
\echo ''

-- Add the column if it doesn't exist
ALTER TABLE trapper.sot_requests
ADD COLUMN IF NOT EXISTS not_assessing_reason TEXT;

COMMENT ON COLUMN trapper.sot_requests.not_assessing_reason IS
'Reason for not assessing kittens for foster placement. Values:
  - older_kittens: Older kittens (6+ months) - no capacity
  - no_foster_capacity: No foster capacity currently
  - feral_unsuitable: Feral/unsocialized - unsuitable for foster
  - health_concerns: Health concerns preclude foster
  - owner_keeping: Owner plans to keep
  - already_altered: Already altered - no intervention needed
  - other: Other reason (details in notes)';

\echo ''
\echo '=== MIG_610 Complete ==='
\echo 'Added not_assessing_reason column to sot_requests'
\echo ''
