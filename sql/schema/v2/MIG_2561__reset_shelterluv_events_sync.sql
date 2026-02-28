-- MIG_2561: Reset ShelterLuv Events Sync State
--
-- Problem (DATA_GAP_057): Events sync uses "Time" (immutable event occurrence)
-- instead of "LastUpdatedUnixTime" (record modification time) for incremental sync.
--
-- Result: Events sync frozen at Jan 23 with only 100 records, while 3,248+ events
-- exist in ShelterLuv. Animals and People sync correctly (today's data) because
-- they use LastUpdatedUnixTime.
--
-- Fix (2 parts):
-- 1. TypeScript: Change line 329 from "Time" to "LastUpdatedUnixTime" (manual)
-- 2. SQL: Reset events sync state to trigger full re-fetch
--
-- After applying this migration AND the TypeScript fix, the next cron run will
-- fetch all 3,248+ events with proper incremental sync going forward.
--
-- Created: 2026-02-27

\echo ''
\echo '=============================================='
\echo '  MIG_2561: Reset ShelterLuv Events Sync'
\echo '=============================================='
\echo ''

-- Show current state
\echo 'BEFORE: Current sync state for events:'
SELECT sync_type, last_sync_timestamp, records_synced, last_sync_at, error_message
FROM source.shelterluv_sync_state
WHERE sync_type = 'events';

-- Reset events sync state
UPDATE source.shelterluv_sync_state
SET last_sync_timestamp = NULL,
    last_sync_at = NULL,
    records_synced = 0,
    error_message = 'Reset by MIG_2561 - fixing timestamp field from Time to LastUpdatedUnixTime'
WHERE sync_type = 'events';

\echo ''
\echo 'AFTER: Events sync state reset:'
SELECT sync_type, last_sync_timestamp, records_synced, last_sync_at, error_message
FROM source.shelterluv_sync_state
WHERE sync_type = 'events';

-- Add comment explaining the fix
COMMENT ON TABLE source.shelterluv_sync_state IS
'Tracks ShelterLuv API incremental sync state per entity type.

Fields:
- sync_type: Entity type (animals, people, events)
- last_sync_timestamp: Unix timestamp for incremental fetching
- records_synced: Total records synced so far
- last_sync_at: When last sync occurred
- error_message: Last error if any

MIG_2561 FIX (2026-02-27): Events sync was frozen because it used "Time"
(immutable event occurrence timestamp) instead of "LastUpdatedUnixTime"
(record modification timestamp) for incremental sync. After fixing the
TypeScript code, this migration resets the state to trigger a full re-fetch.';

\echo ''
\echo 'IMPORTANT: You must also apply the TypeScript fix:'
\echo '  File: apps/web/src/app/api/cron/shelterluv-sync/route.ts'
\echo '  Line 329: Change "Time" to "LastUpdatedUnixTime"'
\echo ''
\echo '=============================================='
\echo '  MIG_2561 Complete'
\echo '=============================================='
\echo ''
