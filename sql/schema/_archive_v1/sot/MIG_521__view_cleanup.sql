-- =====================================================
-- MIG_521: View Cleanup
-- =====================================================
-- Consolidates and cleans up versioned views based on
-- comprehensive codebase analysis.
--
-- Changes:
--   1. Remove v_ffr_impact_summary from Tippy catalog (doesn't exist)
--   2. Create v_person_list as alias to v_person_list_v3
--   3. Drop v_cat_clinic_history_v2 (superseded by v_cat_clinic_history)
--
-- Kept intentionally (DO NOT remove):
--   - v_place_detail and v_place_detail_v2 (different behavior, both used)
--   - v_search_unified_v3 (used in scripts/api/search.mjs)
-- =====================================================

\echo '=========================================='
\echo 'MIG_521: View Cleanup'
\echo '=========================================='

-- -----------------------------------------------------
-- PART 1: Remove non-existent view from Tippy catalog
-- -----------------------------------------------------

\echo ''
\echo '1. Removing v_ffr_impact_summary from Tippy catalog (view does not exist)...'

DELETE FROM trapper.tippy_view_catalog
WHERE view_name = 'v_ffr_impact_summary';

-- -----------------------------------------------------
-- PART 2: Create v_person_list as alias to v_person_list_v3
-- -----------------------------------------------------

\echo ''
\echo '2. Creating v_person_list as alias to v_person_list_v3...'

-- First check if v_person_list_v3 exists
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.views
        WHERE table_schema = 'trapper' AND table_name = 'v_person_list_v3'
    ) THEN
        -- Drop existing v_person_list if it has different columns
        DROP VIEW IF EXISTS trapper.v_person_list CASCADE;
        -- Create v_person_list that mirrors v_person_list_v3
        EXECUTE 'CREATE VIEW trapper.v_person_list AS SELECT * FROM trapper.v_person_list_v3';
        RAISE NOTICE 'Created v_person_list as alias to v_person_list_v3';
    ELSE
        RAISE NOTICE 'v_person_list_v3 does not exist, skipping alias creation';
    END IF;
END $$;

COMMENT ON VIEW trapper.v_person_list IS
'Canonical person list view. Alias for v_person_list_v3 for naming consistency.';

-- -----------------------------------------------------
-- PART 3: Drop superseded v_cat_clinic_history_v2
-- -----------------------------------------------------

\echo ''
\echo '3. Dropping v_cat_clinic_history_v2 (superseded by v_cat_clinic_history)...'

-- v_cat_clinic_history_v2 was created in MIG_175 but superseded by
-- v_cat_clinic_history in MIG_307. No code references _v2.
DROP VIEW IF EXISTS trapper.v_cat_clinic_history_v2;

-- -----------------------------------------------------
-- PART 4: Add v_person_list to Tippy catalog
-- -----------------------------------------------------

\echo ''
\echo '4. Adding v_person_list to Tippy catalog...'

INSERT INTO trapper.tippy_view_catalog (
    view_name, category, description, key_columns, filter_columns, example_questions
)
VALUES (
    'v_person_list',
    'entity',
    'List of all people with contact info and role counts',
    ARRAY['person_id', 'display_name', 'email', 'phone'],
    ARRAY['display_name', 'email', 'phone'],
    ARRAY['List all people', 'Find person by name', 'People with email']
)
ON CONFLICT (view_name) DO UPDATE SET
    description = EXCLUDED.description,
    key_columns = EXCLUDED.key_columns,
    filter_columns = EXCLUDED.filter_columns,
    example_questions = EXCLUDED.example_questions,
    updated_at = NOW();

-- -----------------------------------------------------
-- PART 5: Document view relationships
-- -----------------------------------------------------

\echo ''
\echo '5. Adding documentation comments to versioned views...'

-- Document the intentional differences between v_place_detail variants
COMMENT ON VIEW trapper.v_place_detail IS
'Basic place detail view for Tippy and general use. Shows all places where merged_into_place_id IS NULL.
See also: v_place_detail_v2 which has smart display_name logic.';

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.views
        WHERE table_schema = 'trapper' AND table_name = 'v_place_detail_v2'
    ) THEN
        EXECUTE $sql$
            COMMENT ON VIEW trapper.v_place_detail_v2 IS
            'Enhanced place detail view used by /api/places/[id]. Features:
             - Smart display_name: uses address if name matches associated person
             - is_valid_person_name filter for people list
             - Only shows is_address_backed=true places
             See also: v_place_detail for basic version.'
        $sql$;
    END IF;
END $$;

-- Document v_search_unified_v3
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.views
        WHERE table_schema = 'trapper' AND table_name = 'v_search_unified_v3'
    ) THEN
        EXECUTE $sql$
            COMMENT ON VIEW trapper.v_search_unified_v3 IS
            'Unified search view across cats, people, and places. Used by scripts/api/search.mjs.
             Different from v_search_sot_unified which is used by Tippy.'
        $sql$;
    END IF;
END $$;

-- -----------------------------------------------------
-- PART 6: Verification
-- -----------------------------------------------------

\echo ''
\echo '6. Verification...'

SELECT 'Tippy catalog check' as test,
    CASE WHEN NOT EXISTS (
        SELECT 1 FROM trapper.tippy_view_catalog WHERE view_name = 'v_ffr_impact_summary'
    ) THEN 'PASS: v_ffr_impact_summary removed'
    ELSE 'FAIL: v_ffr_impact_summary still in catalog' END as result;

SELECT 'v_person_list check' as test,
    CASE WHEN EXISTS (
        SELECT 1 FROM information_schema.views
        WHERE table_schema = 'trapper' AND table_name = 'v_person_list'
    ) THEN 'PASS: v_person_list exists'
    ELSE 'FAIL: v_person_list not created' END as result;

SELECT 'v_cat_clinic_history_v2 check' as test,
    CASE WHEN NOT EXISTS (
        SELECT 1 FROM information_schema.views
        WHERE table_schema = 'trapper' AND table_name = 'v_cat_clinic_history_v2'
    ) THEN 'PASS: v_cat_clinic_history_v2 dropped'
    ELSE 'INFO: v_cat_clinic_history_v2 still exists (may not have been created)' END as result;

\echo ''
\echo '=== MIG_521 Complete ==='
\echo ''
\echo 'Summary:'
\echo '  - Removed v_ffr_impact_summary from Tippy catalog (did not exist)'
\echo '  - Created v_person_list as alias to v_person_list_v3'
\echo '  - Dropped v_cat_clinic_history_v2 (superseded)'
\echo '  - Added documentation comments to versioned views'
\echo ''
\echo 'Intentionally kept (both versions used):'
\echo '  - v_place_detail (Tippy) and v_place_detail_v2 (API)'
\echo '  - v_search_unified_v3 (scripts) and v_search_sot_unified (Tippy)'
\echo ''

SELECT trapper.record_migration(521, 'MIG_521__view_cleanup');
