-- MIG_2100: V2 Data Flow Fixes - Master Migration
-- Date: 2026-02-14
--
-- This migration runs all the V2 data flow fixes in the correct order.
-- Run this single file to fix data flow issues and enable full V2 functionality.
--
-- Migrations included:
--   MIG_2095 - Populate cat_identifiers from denormalized fields
--   MIG_2096 - Backfill relationship tables if empty
--   MIG_2097 - Sync triggers for cat/person identifiers
--   MIG_2098 - Compatibility views for remaining V1 tables (safe version)
--   MIG_2110 - Disease tracking V2 (ops.disease_types, ops.place_disease_status)
--
-- Prerequisites:
--   - MIG_1002 (V2 SOT tables) must be applied
--   - MIG_1003 (V2 OPS tables) must be applied
--   - MIG_2035 (v_place_detail_v2) must be applied
--   - MIG_2051 (find_or_create_cat_by_microchip with animal IDs) must be applied

\echo ''
\echo '=========================================='
\echo '  MIG_2100: V2 Data Flow Fixes'
\echo '=========================================='
\echo ''

-- ============================================================================
-- STEP 1: Apply MIG_2095 - Populate cat_identifiers
-- ============================================================================
\echo '1. Applying MIG_2095 - Populate cat_identifiers...'
\i MIG_2095__populate_cat_identifiers.sql

-- ============================================================================
-- STEP 2: Apply MIG_2096 - Backfill relationship tables
-- ============================================================================
\echo ''
\echo '2. Applying MIG_2096 - Backfill relationship tables...'
\i MIG_2096__backfill_relationship_tables.sql

-- ============================================================================
-- STEP 3: Apply MIG_2097 - Sync triggers
-- ============================================================================
\echo ''
\echo '3. Applying MIG_2097 - Sync triggers...'
\i MIG_2097__sync_cat_identifiers.sql

-- ============================================================================
-- STEP 4: Apply MIG_2098 - Compatibility views
-- ============================================================================
\echo ''
\echo '4. Applying MIG_2098 - Compatibility views...'
\i MIG_2098__ops_compatibility_views.sql

-- ============================================================================
-- STEP 5: Apply MIG_2110 - Disease tracking V2
-- ============================================================================
\echo ''
\echo '5. Applying MIG_2110 - Disease tracking V2...'
\i MIG_2110__disease_tracking_v2.sql

-- ============================================================================
-- FINAL VERIFICATION
-- ============================================================================
\echo ''
\echo '=========================================='
\echo '  FINAL VERIFICATION'
\echo '=========================================='
\echo ''

DO $$
DECLARE
    v_cat_count INT;
    v_cat_id_count INT;
    v_cat_place_count INT;
    v_person_place_count INT;
    v_person_cat_count INT;
    v_ops_view_count INT;
    v_disease_type_count INT;
    v_disease_status_count INT;
BEGIN
    SELECT COUNT(*) INTO v_cat_count FROM sot.cats WHERE merged_into_cat_id IS NULL;
    SELECT COUNT(*) INTO v_cat_id_count FROM sot.cat_identifiers;
    SELECT COUNT(*) INTO v_cat_place_count FROM sot.cat_place;
    SELECT COUNT(*) INTO v_person_place_count FROM sot.person_place;
    SELECT COUNT(*) INTO v_person_cat_count FROM sot.person_cat;
    SELECT COUNT(*) INTO v_ops_view_count FROM information_schema.views WHERE table_schema = 'ops';
    SELECT COUNT(*) INTO v_disease_type_count FROM ops.disease_types;
    SELECT COUNT(*) INTO v_disease_status_count FROM ops.place_disease_status;

    RAISE NOTICE '';
    RAISE NOTICE 'V2 Data Integrity Summary:';
    RAISE NOTICE '  sot.cats: % active records', v_cat_count;
    RAISE NOTICE '  sot.cat_identifiers: % records', v_cat_id_count;
    RAISE NOTICE '  sot.cat_place: % relationships', v_cat_place_count;
    RAISE NOTICE '  sot.person_place: % relationships', v_person_place_count;
    RAISE NOTICE '  sot.person_cat: % relationships', v_person_cat_count;
    RAISE NOTICE '  ops.disease_types: % types', v_disease_type_count;
    RAISE NOTICE '  ops.place_disease_status: % records', v_disease_status_count;
    RAISE NOTICE '  ops.* views: % total', v_ops_view_count;
    RAISE NOTICE '';

    IF v_cat_id_count = 0 THEN
        RAISE WARNING 'cat_identifiers is still empty - check MIG_2095';
    END IF;

    IF v_cat_place_count = 0 THEN
        RAISE WARNING 'cat_place is still empty - check MIG_2096';
    END IF;

    IF v_disease_type_count = 0 THEN
        RAISE WARNING 'disease_types is empty - check MIG_2110';
    END IF;
END $$;

\echo ''
\echo '=========================================='
\echo '  MIG_2100 Complete'
\echo '=========================================='
\echo ''
\echo 'Next steps:'
\echo '  1. Run npm run build to verify TypeScript compiles'
\echo '  2. Test /api/admin/clinic-days/[date]/cats route'
\echo '  3. Test /api/places/[id] route'
\echo '  4. Verify AtlasMap displays pins correctly'
\echo ''
