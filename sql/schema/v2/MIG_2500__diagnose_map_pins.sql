-- MIG_2500__diagnose_map_pins.sql
-- Diagnostic script to identify why ops.v_map_atlas_pins may be failing
--
-- Problem: All map pins showing as grey "reference" pins instead of active colored pins.
-- Cause: The ops.v_map_atlas_pins view is failing, triggering the API fallback which
--        sets all pins to pin_tier='reference'.
--
-- This script checks all dependencies of the view.
-- Run: psql "$DATABASE_URL" -f sql/schema/v2/MIG_2500__diagnose_map_pins.sql
-- Created: 2026-02-25

\echo ''
\echo '=============================================='
\echo '  MIG_2500: Diagnose Map Pins Issue'
\echo '=============================================='
\echo ''

-- ============================================================================
-- 1. CHECK FUNCTION DEPENDENCIES
-- ============================================================================

\echo '1. Checking function dependencies...'
\echo ''

\echo '1.1 sot.is_organization_name:'
SELECT EXISTS (
    SELECT 1 FROM information_schema.routines
    WHERE routine_schema = 'sot' AND routine_name = 'is_organization_name'
) as exists;

\echo ''
\echo '1.2 sot.v_place_alteration_history:'
SELECT EXISTS (
    SELECT 1 FROM information_schema.views
    WHERE table_schema = 'sot' AND table_name = 'v_place_alteration_history'
) as exists;

\echo ''
\echo '1.3 ops.v_place_disease_summary:'
SELECT EXISTS (
    SELECT 1 FROM information_schema.views
    WHERE table_schema = 'ops' AND table_name = 'v_place_disease_summary'
) as exists;

\echo ''
\echo '1.4 ops.person_roles table:'
SELECT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'ops' AND table_name = 'person_roles'
) as exists;

\echo ''
\echo '1.5 sot.person_roles table (alternative):'
SELECT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'sot' AND table_name = 'person_roles'
) as exists;

-- ============================================================================
-- 2. CHECK TABLE DEPENDENCIES
-- ============================================================================

\echo ''
\echo '2. Checking table dependencies...'
\echo ''

\echo '2.1 sot.places:'
SELECT COUNT(*) as total, COUNT(*) FILTER (WHERE merged_into_place_id IS NULL) as canonical
FROM sot.places;

\echo ''
\echo '2.2 sot.addresses:'
SELECT COUNT(*) as total FROM sot.addresses;

\echo ''
\echo '2.3 sot.cat_place:'
SELECT COUNT(*) as total FROM sot.cat_place;

\echo ''
\echo '2.4 sot.person_place:'
SELECT COUNT(*) as total FROM sot.person_place;

\echo ''
\echo '2.5 ops.requests:'
SELECT COUNT(*) as total FROM ops.requests;

\echo ''
\echo '2.6 ops.intake_submissions:'
SELECT COUNT(*) as total FROM ops.intake_submissions;

\echo ''
\echo '2.7 ops.google_map_entries:'
SELECT COUNT(*) as total FROM ops.google_map_entries;

-- ============================================================================
-- 3. TEST THE VIEW DIRECTLY
-- ============================================================================

\echo ''
\echo '3. Testing ops.v_map_atlas_pins view...'
\echo ''

-- Try to select from the view
DO $$
DECLARE
    v_count INT;
BEGIN
    SELECT COUNT(*) INTO v_count FROM ops.v_map_atlas_pins LIMIT 1;
    RAISE NOTICE 'View works! Found % rows', v_count;
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'VIEW FAILED: %', SQLERRM;
END $$;

-- ============================================================================
-- 4. CHECK PIN TIER DISTRIBUTION
-- ============================================================================

\echo ''
\echo '4. Pin tier distribution (if view works):'
SELECT
    pin_tier,
    pin_style,
    COUNT(*) as count
FROM ops.v_map_atlas_pins
GROUP BY pin_tier, pin_style
ORDER BY pin_tier, pin_style;

\echo ''
\echo '5. Places with cats (should be active):'
SELECT COUNT(*) as places_with_cats
FROM ops.v_map_atlas_pins
WHERE cat_count > 0;

\echo ''
\echo '6. Places with requests (should be active):'
SELECT COUNT(*) as places_with_requests
FROM ops.v_map_atlas_pins
WHERE request_count > 0;

\echo ''
\echo '7. Sample of active pins:'
SELECT
    LEFT(address, 50) as address,
    cat_count,
    request_count,
    pin_style,
    pin_tier
FROM ops.v_map_atlas_pins
WHERE pin_tier = 'active'
ORDER BY cat_count DESC
LIMIT 10;

\echo ''
\echo '8. Sample of reference pins (expected to be few):'
SELECT
    LEFT(address, 50) as address,
    cat_count,
    request_count,
    google_entry_count,
    pin_style,
    pin_tier
FROM ops.v_map_atlas_pins
WHERE pin_tier = 'reference'
LIMIT 10;

-- ============================================================================
-- 5. CHECK FOR PERSON_ROLES LOCATION ISSUE
-- ============================================================================

\echo ''
\echo '9. Checking person_roles table location...'

-- The view references ops.person_roles but it might be in sot schema
DO $$
DECLARE
    v_ops_exists BOOLEAN;
    v_sot_exists BOOLEAN;
BEGIN
    SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'ops' AND table_name = 'person_roles') INTO v_ops_exists;
    SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'sot' AND table_name = 'person_roles') INTO v_sot_exists;

    IF v_ops_exists THEN
        RAISE NOTICE 'person_roles exists in ops schema (correct)';
    ELSIF v_sot_exists THEN
        RAISE NOTICE 'person_roles exists in sot schema but view expects ops.person_roles - THIS IS THE BUG!';
    ELSE
        RAISE NOTICE 'person_roles table not found in either schema - THIS IS THE BUG!';
    END IF;
END $$;

\echo ''
\echo '=============================================='
\echo '  Diagnosis Complete'
\echo '=============================================='
\echo ''
\echo 'If the view failed, check the error message above.'
\echo 'Common issues:'
\echo '  1. ops.person_roles table missing (should be in ops schema)'
\echo '  2. ops.v_place_disease_summary view missing (run MIG_2110)'
\echo '  3. sot.is_organization_name function missing (run MIG_2017)'
\echo ''
