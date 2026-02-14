-- MIG_2299: Drop Trapper Schema (Final V1 Elimination)
-- Date: 2026-02-14
--
-- Prerequisites:
--   - MIG_2202: All functions moved to sot/ops
--   - Code updated to use sot/ops directly (scripts/migration/update_trapper_to_v2.sh)
--   - npm run build passes without trapper references
--
-- This migration drops the entire trapper schema (views and functions only - no data loss)
--
-- SAFETY: Trapper schema contains ONLY:
--   - 39 views pointing to sot/ops tables
--   - 27 functions that are wrappers calling sot/ops functions
--   - NO base tables (all data is in sot/ops)

\echo ''
\echo '=============================================='
\echo '  MIG_2299: Drop Trapper Schema'
\echo '=============================================='
\echo ''
\echo 'WARNING: This will drop the entire trapper schema!'
\echo 'Ensure code has been updated to use sot/ops directly.'
\echo ''

-- ============================================================================
-- 1. PRE-DROP VERIFICATION
-- ============================================================================

\echo '1. Pre-drop verification...'

DO $$
DECLARE
    v_view_count INT;
    v_func_count INT;
    v_table_count INT;
BEGIN
    -- Count views
    SELECT COUNT(*) INTO v_view_count
    FROM information_schema.views
    WHERE table_schema = 'trapper';

    -- Count functions
    SELECT COUNT(*) INTO v_func_count
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'trapper';

    -- Count actual tables (not views)
    SELECT COUNT(*) INTO v_table_count
    FROM information_schema.tables
    WHERE table_schema = 'trapper'
      AND table_type = 'BASE TABLE';

    RAISE NOTICE 'Trapper schema contents:';
    RAISE NOTICE '  Views: %', v_view_count;
    RAISE NOTICE '  Functions: %', v_func_count;
    RAISE NOTICE '  Base tables: % (should be 0)', v_table_count;

    IF v_table_count > 0 THEN
        RAISE EXCEPTION 'ABORT: Trapper has % base tables - data would be lost!', v_table_count;
    END IF;

    RAISE NOTICE '';
    RAISE NOTICE 'Safe to drop: trapper schema contains only views and functions.';
END $$;

-- ============================================================================
-- 2. DROP SCHEMA CASCADE
-- ============================================================================

\echo ''
\echo '2. Dropping trapper schema...'

DROP SCHEMA IF EXISTS trapper CASCADE;

\echo '   Trapper schema dropped!'

-- ============================================================================
-- 3. POST-DROP VERIFICATION
-- ============================================================================

\echo ''
\echo '=============================================='
\echo '  POST-DROP VERIFICATION'
\echo '=============================================='
\echo ''

DO $$
DECLARE
    v_sot_tables INT;
    v_ops_tables INT;
    v_sot_funcs INT;
    v_ops_funcs INT;
BEGIN
    -- Count sot tables
    SELECT COUNT(*) INTO v_sot_tables
    FROM information_schema.tables
    WHERE table_schema = 'sot';

    -- Count ops tables
    SELECT COUNT(*) INTO v_ops_tables
    FROM information_schema.tables
    WHERE table_schema = 'ops';

    -- Count sot functions
    SELECT COUNT(*) INTO v_sot_funcs
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'sot';

    -- Count ops functions
    SELECT COUNT(*) INTO v_ops_funcs
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'ops';

    RAISE NOTICE 'V2 Schema Status:';
    RAISE NOTICE '  sot.*: % tables/views, % functions', v_sot_tables, v_sot_funcs;
    RAISE NOTICE '  ops.*: % tables/views, % functions', v_ops_tables, v_ops_funcs;
    RAISE NOTICE '';
    RAISE NOTICE 'Trapper schema: DROPPED';
END $$;

\echo ''
\echo '=============================================='
\echo '  MIG_2299 Complete!'
\echo '=============================================='
\echo ''
\echo 'V1 ELIMINATION COMPLETE!'
\echo ''
\echo 'The trapper schema has been dropped.'
\echo 'All data remains safely in sot.* and ops.* schemas.'
\echo ''
\echo 'Schema architecture:'
\echo '  sot.* - Source of Truth (entities: cats, people, places)'
\echo '  ops.* - Operations (workflows: appointments, requests, email)'
\echo ''
