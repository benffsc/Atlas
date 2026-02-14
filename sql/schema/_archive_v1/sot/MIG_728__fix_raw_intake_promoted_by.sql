\echo '=== MIG_728: Fix raw_intake_request promoted_by column ==='

-- The promote_intake_request function tries to set promoted_by on raw_intake_request
-- but that column doesn't exist. Add it.

ALTER TABLE trapper.raw_intake_request
  ADD COLUMN IF NOT EXISTS promoted_by TEXT;

COMMENT ON COLUMN trapper.raw_intake_request.promoted_by IS
'User/system that promoted this raw intake to sot_requests';

\echo 'Added promoted_by column to raw_intake_request'
