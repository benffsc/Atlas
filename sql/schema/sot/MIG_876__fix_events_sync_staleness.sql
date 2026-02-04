\echo '=== MIG_876: Fix Stale Events Sync ==='
\echo 'Problem: Events last_sync_timestamp stuck at Jan 22 (1769106408).'
\echo 'If API returns 0 new records, timestamp never advances → sync looks stale.'
\echo ''

-- ============================================================================
-- 1. ADD last_check_at COLUMN
-- ============================================================================

\echo '--- Step 1: Add last_check_at column ---'

ALTER TABLE trapper.shelterluv_sync_state
  ADD COLUMN IF NOT EXISTS last_check_at TIMESTAMPTZ;

COMMENT ON COLUMN trapper.shelterluv_sync_state.last_check_at IS
  'Always updated when sync runs, even if 0 new records.
   Distinguishes "checked recently but nothing new" from "hasn''t run at all".';

-- Set initial value from last_sync_at for existing rows
UPDATE trapper.shelterluv_sync_state
SET last_check_at = last_sync_at
WHERE last_check_at IS NULL AND last_sync_at IS NOT NULL;

-- ============================================================================
-- 2. RESET EVENTS SYNC TIMESTAMP
-- ============================================================================

\echo '--- Step 2: Reset events sync timestamp ---'

\echo 'Before:'
SELECT sync_type, last_sync_timestamp,
  to_timestamp(last_sync_timestamp) as last_record_time,
  last_sync_at
FROM trapper.shelterluv_sync_state
WHERE sync_type = 'events';

-- Reset to NULL to force full re-check on next cron run
UPDATE trapper.shelterluv_sync_state
SET last_sync_timestamp = NULL,
    error_message = NULL,
    updated_at = NOW()
WHERE sync_type = 'events';

\echo 'After reset:'
SELECT sync_type, last_sync_timestamp, last_sync_at, last_check_at
FROM trapper.shelterluv_sync_state;

-- ============================================================================
-- 3. UPDATE update_shelterluv_sync_state() TO SET last_check_at
-- ============================================================================

\echo '--- Step 3: Update sync state function ---'

DROP FUNCTION IF EXISTS trapper.update_shelterluv_sync_state(text, bigint, integer, integer, text);

CREATE OR REPLACE FUNCTION trapper.update_shelterluv_sync_state(
  p_sync_type TEXT,
  p_last_timestamp BIGINT,
  p_records_synced INT,
  p_total_records INT,
  p_error TEXT DEFAULT NULL
) RETURNS VOID AS $$
BEGIN
  INSERT INTO trapper.shelterluv_sync_state (
    sync_type, last_sync_timestamp, last_sync_at, last_check_at,
    records_synced, total_records, error_message, updated_at
  ) VALUES (
    p_sync_type, p_last_timestamp, NOW(), NOW(),
    p_records_synced, p_total_records, p_error, NOW()
  )
  ON CONFLICT (sync_type)
  DO UPDATE SET
    last_sync_timestamp = COALESCE(EXCLUDED.last_sync_timestamp, trapper.shelterluv_sync_state.last_sync_timestamp),
    last_sync_at = CASE
      WHEN EXCLUDED.last_sync_timestamp IS NOT NULL THEN NOW()
      ELSE trapper.shelterluv_sync_state.last_sync_at
    END,
    last_check_at = NOW(),  -- Always update: we checked, even if nothing new
    records_synced = EXCLUDED.records_synced,
    total_records = EXCLUDED.total_records,
    error_message = EXCLUDED.error_message,
    updated_at = NOW();
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.update_shelterluv_sync_state IS
  'Updates sync state. Always sets last_check_at (even with 0 records).
   Only advances last_sync_at when new records are actually fetched.';

-- ============================================================================
-- 4. REPLACE v_shelterluv_sync_status VIEW
-- ============================================================================

\echo '--- Step 4: Update sync status view ---'

DROP VIEW IF EXISTS trapper.v_shelterluv_sync_status;

CREATE VIEW trapper.v_shelterluv_sync_status AS
SELECT
  sync_type,
  last_sync_at,
  last_check_at,
  to_timestamp(last_sync_timestamp::double precision) AS last_record_time,
  records_synced AS last_batch_size,
  total_records,
  error_message,
  (SELECT COUNT(*) FROM trapper.staged_records sr
   WHERE sr.source_system = 'shelterluv' AND sr.source_table = ss.sync_type
     AND sr.is_processed IS NOT TRUE) AS pending_processing,
  CASE
    -- Use last_check_at (when we last actually ran) for health
    WHEN last_check_at IS NULL AND last_sync_at IS NULL THEN 'never'
    WHEN COALESCE(last_check_at, last_sync_at) > (NOW() - INTERVAL '1 day') THEN 'recent'
    WHEN COALESCE(last_check_at, last_sync_at) > (NOW() - INTERVAL '7 days') THEN 'stale'
    ELSE 'very_stale'
  END AS sync_health,
  CASE
    WHEN last_check_at IS NOT NULL AND last_sync_at IS NOT NULL
      AND last_check_at > last_sync_at + INTERVAL '2 days'
    THEN 'checked_no_new_data'
    ELSE 'normal'
  END AS check_status
FROM trapper.shelterluv_sync_state ss
ORDER BY sync_type;

COMMENT ON VIEW trapper.v_shelterluv_sync_status IS
  'ShelterLuv sync health. Uses last_check_at for health (not last_sync_at).
   check_status = "checked_no_new_data" means cron is running but API has no new records.';

-- ============================================================================
-- 5. VERIFICATION
-- ============================================================================

\echo ''
\echo '--- Verification ---'

SELECT sync_type, last_sync_at, last_check_at, sync_health, check_status, pending_processing
FROM trapper.v_shelterluv_sync_status;

\echo ''
\echo '=== MIG_876 Complete ==='
\echo 'Events sync timestamp reset to NULL (will re-sync on next cron).'
\echo 'Added last_check_at for accurate health monitoring.'
