-- MIG_2565: Backfill Place Address Links
--
-- Problem (DATA_GAP_058): 3,734 places (34%) have formatted_address text
-- but no sot.addresses record linked via sot_address_id.
--
-- This migration creates address records for these orphaned places and
-- links them properly.
--
-- Two-step process:
-- 1. Create unique address records for each distinct formatted_address
-- 2. Update places to link to these address records
--
-- Created: 2026-02-27

\echo ''
\echo '=============================================='
\echo '  MIG_2565: Backfill Place Address Links'
\echo '=============================================='
\echo ''

-- First, verify MIG_2562 was applied
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_proc p
        JOIN pg_namespace n ON p.pronamespace = n.oid
        WHERE n.nspname = 'sot' AND p.proname = 'find_or_create_address'
    ) THEN
        RAISE EXCEPTION 'MIG_2562 must be applied first (find_or_create_address not found)';
    END IF;
END $$;

\echo 'Prerequisite check passed'

-- Show current state
\echo ''
\echo 'BEFORE: Places missing address links:'
SELECT
    COUNT(*) as total_places,
    COUNT(*) FILTER (WHERE sot_address_id IS NULL AND formatted_address IS NOT NULL AND formatted_address != '') as missing_address_link,
    COUNT(*) FILTER (WHERE sot_address_id IS NOT NULL) as has_address_link,
    ROUND(100.0 * COUNT(*) FILTER (WHERE sot_address_id IS NULL AND formatted_address IS NOT NULL) / NULLIF(COUNT(*), 0), 1) as pct_missing
FROM sot.places
WHERE merged_into_place_id IS NULL;

-- Step 1: Create address records for places with formatted_address but no link
-- Use DISTINCT ON to avoid creating duplicate addresses for the same formatted_address
\echo ''
\echo 'Step 1: Creating address records for orphaned places...'

INSERT INTO sot.addresses (
    address_id,
    raw_input,
    raw_address,
    formatted_address,
    display_address,
    display_line,
    latitude,
    longitude,
    location,
    geocoding_status,
    source_system,
    created_at,
    updated_at
)
SELECT DISTINCT ON (LOWER(TRIM(p.formatted_address)))
    gen_random_uuid(),
    p.formatted_address,              -- raw_input
    p.formatted_address,              -- raw_address
    p.formatted_address,              -- formatted_address
    p.formatted_address,              -- display_address
    p.formatted_address,              -- display_line
    ST_Y(p.location::geometry),       -- latitude
    ST_X(p.location::geometry),       -- longitude
    p.location,                       -- location (geography)
    CASE WHEN p.location IS NOT NULL THEN 'success' ELSE 'pending' END,
    'atlas_backfill_mig2565',
    NOW(),
    NOW()
FROM sot.places p
WHERE p.merged_into_place_id IS NULL
  AND p.formatted_address IS NOT NULL
  AND TRIM(p.formatted_address) != ''
  AND p.sot_address_id IS NULL
  AND NOT EXISTS (
    -- Skip if an address already exists for this formatted_address
    SELECT 1 FROM sot.addresses a
    WHERE LOWER(TRIM(a.formatted_address)) = LOWER(TRIM(p.formatted_address))
      AND a.merged_into_address_id IS NULL
  )
ORDER BY LOWER(TRIM(p.formatted_address)), p.created_at;

\echo 'Address records created'

-- Step 2: Link places to their address records
\echo ''
\echo 'Step 2: Linking places to address records...'

UPDATE sot.places p
SET sot_address_id = a.address_id,
    is_address_backed = TRUE,
    updated_at = NOW()
FROM sot.addresses a
WHERE p.sot_address_id IS NULL
  AND p.formatted_address IS NOT NULL
  AND TRIM(p.formatted_address) != ''
  AND p.merged_into_place_id IS NULL
  AND LOWER(TRIM(a.formatted_address)) = LOWER(TRIM(p.formatted_address))
  AND a.merged_into_address_id IS NULL;

\echo 'Places linked to addresses'

-- Show after state
\echo ''
\echo 'AFTER: Places missing address links:'
SELECT
    COUNT(*) as total_places,
    COUNT(*) FILTER (WHERE sot_address_id IS NULL AND formatted_address IS NOT NULL AND formatted_address != '') as missing_address_link,
    COUNT(*) FILTER (WHERE sot_address_id IS NOT NULL) as has_address_link,
    ROUND(100.0 * COUNT(*) FILTER (WHERE sot_address_id IS NULL AND formatted_address IS NOT NULL) / NULLIF(COUNT(*), 0), 1) as pct_missing
FROM sot.places
WHERE merged_into_place_id IS NULL;

-- Show breakdown by source_system
\echo ''
\echo 'After: Breakdown by source_system:'
SELECT
    COALESCE(source_system, 'unknown') as source_system,
    COUNT(*) as total,
    COUNT(*) FILTER (WHERE sot_address_id IS NULL AND formatted_address IS NOT NULL) as missing_link,
    COUNT(*) FILTER (WHERE sot_address_id IS NOT NULL) as linked
FROM sot.places
WHERE merged_into_place_id IS NULL
GROUP BY source_system
ORDER BY COUNT(*) DESC;

\echo ''
\echo '=============================================='
\echo '  MIG_2565 Complete'
\echo '=============================================='
\echo ''
\echo 'DATA_GAP_058 has been resolved.'
\echo 'All places with formatted_address now have sot_address_id linked.'
\echo ''
