-- MIG_2050: Fix is_address_backed on sot.places
-- Date: 2026-02-13
--
-- Issue: 7,421 places have:
--   - formatted_address populated (from reverse geocoding)
--   - address_id linked to sot.addresses (but addresses are empty)
--   - sot_address_id = NULL
--   - is_address_backed = FALSE
--
-- Root Cause: record_reverse_geocoding_result() sets formatted_address
-- but does NOT populate sot.addresses or set is_address_backed = TRUE
--
-- Fix:
--   1. Populate sot.addresses with data from sot.places
--   2. Set sot_address_id = address_id
--   3. Set is_address_backed = TRUE

\echo ''
\echo '=============================================='
\echo '  MIG_2050: Fix is_address_backed'
\echo '=============================================='
\echo ''

-- ============================================================================
-- Check before state
-- ============================================================================

\echo '1. Checking current state...'

SELECT 'BEFORE: sot.places is_address_backed' as context,
  COUNT(*) FILTER (WHERE is_address_backed = TRUE) as backed,
  COUNT(*) FILTER (WHERE is_address_backed = FALSE) as not_backed,
  COUNT(*) FILTER (WHERE sot_address_id IS NOT NULL) as has_sot_addr_id,
  COUNT(*) FILTER (WHERE address_id IS NOT NULL) as has_addr_id,
  COUNT(*) as total
FROM sot.places WHERE merged_into_place_id IS NULL;

SELECT 'BEFORE: sot.addresses populated' as context,
  COUNT(*) FILTER (WHERE formatted_address IS NOT NULL AND formatted_address != '') as has_formatted,
  COUNT(*) as total
FROM sot.addresses WHERE merged_into_address_id IS NULL;

-- ============================================================================
-- Step 1: Populate sot.addresses from sot.places
-- ============================================================================

\echo ''
\echo '2. Populating sot.addresses from sot.places...'

UPDATE sot.addresses a
SET
  formatted_address = p.formatted_address,
  display_line = p.formatted_address,
  raw_address = p.formatted_address,
  display_address = p.display_name,
  -- Extract components if possible (basic parsing)
  latitude = ST_Y(p.location::geometry),
  longitude = ST_X(p.location::geometry),
  location = p.location,
  geocoding_status = 'success',  -- Valid: pending, success, failed, manual
  geocoded_at = NOW(),
  source_system = COALESCE(p.source_system, 'atlas_migration'),
  updated_at = NOW()
FROM sot.places p
WHERE p.address_id = a.address_id
  AND p.merged_into_place_id IS NULL
  AND a.merged_into_address_id IS NULL
  AND p.formatted_address IS NOT NULL
  AND p.formatted_address != ''
  AND (a.formatted_address IS NULL OR a.formatted_address = '');

\echo '   Populated addresses'

-- ============================================================================
-- Step 2: Set sot_address_id = address_id on places
-- ============================================================================

\echo ''
\echo '3. Setting sot_address_id = address_id on places...'

UPDATE sot.places
SET
  sot_address_id = address_id,
  updated_at = NOW()
WHERE merged_into_place_id IS NULL
  AND address_id IS NOT NULL
  AND sot_address_id IS NULL;

\echo '   Set sot_address_id'

-- ============================================================================
-- Step 3: Set is_address_backed = TRUE where we have sot_address_id
-- ============================================================================

\echo ''
\echo '4. Setting is_address_backed = TRUE...'

UPDATE sot.places
SET
  is_address_backed = TRUE,
  updated_at = NOW()
WHERE merged_into_place_id IS NULL
  AND sot_address_id IS NOT NULL
  AND is_address_backed = FALSE;

\echo '   Set is_address_backed'

-- ============================================================================
-- Verification
-- ============================================================================

\echo ''
\echo '=============================================='
\echo '  VERIFICATION'
\echo '=============================================='

SELECT 'AFTER: sot.places is_address_backed' as context,
  COUNT(*) FILTER (WHERE is_address_backed = TRUE) as backed,
  COUNT(*) FILTER (WHERE is_address_backed = FALSE) as not_backed,
  COUNT(*) FILTER (WHERE sot_address_id IS NOT NULL) as has_sot_addr_id,
  COUNT(*) as total
FROM sot.places WHERE merged_into_place_id IS NULL;

SELECT 'AFTER: sot.addresses populated' as context,
  COUNT(*) FILTER (WHERE formatted_address IS NOT NULL AND formatted_address != '') as has_formatted,
  COUNT(*) as total
FROM sot.addresses WHERE merged_into_address_id IS NULL;

\echo ''
\echo '=============================================='
\echo '  MIG_2050 Complete'
\echo '=============================================='
\echo ''
\echo 'Fixed is_address_backed by:'
\echo '  1. Populating sot.addresses with formatted_address from places'
\echo '  2. Setting sot_address_id = address_id on places'
\echo '  3. Setting is_address_backed = TRUE'
\echo ''
\echo 'NEXT STEP: Fix record_reverse_geocoding_result() to do this automatically'
\echo ''
