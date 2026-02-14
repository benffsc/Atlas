\echo '=== MIG_331: Populate Households from Existing Data ==='
\echo 'Builds household relationships from shared addresses and identifiers'
\echo ''

-- ============================================================================
-- PROBLEM
-- No households exist despite 11,000+ people in the database.
-- Need to detect households from:
-- 1. People at the same address
-- 2. People sharing phone numbers
-- 3. People sharing emails (family accounts)
-- ============================================================================

\echo 'Step 1: Current household status...'
SELECT
    (SELECT COUNT(*) FROM trapper.households) as existing_households,
    (SELECT COUNT(DISTINCT person_id) FROM trapper.household_members WHERE valid_to IS NULL) as people_in_households,
    (SELECT COUNT(*) FROM trapper.sot_people WHERE merged_into_person_id IS NULL) as total_people;

-- ============================================================================
-- Step 2: Detect shared identifiers
-- ============================================================================

\echo ''
\echo 'Step 2: Detecting shared identifiers...'

SELECT * FROM trapper.data_engine_detect_shared_identifiers();

-- ============================================================================
-- Step 3: Build households
-- ============================================================================

\echo ''
\echo 'Step 3: Building households from shared addresses...'

SELECT * FROM trapper.data_engine_build_households();

-- ============================================================================
-- Step 4: Populate soft blacklist from shared identifiers
-- ============================================================================

\echo ''
\echo 'Step 4: Populating soft blacklist...'

SELECT * FROM trapper.data_engine_populate_soft_blacklist();

-- ============================================================================
-- Step 5: Summary
-- ============================================================================

\echo ''
\echo '=== Household Summary ==='

SELECT
    (SELECT COUNT(*) FROM trapper.households) as total_households,
    (SELECT COUNT(DISTINCT person_id) FROM trapper.household_members WHERE valid_to IS NULL) as people_in_households,
    (SELECT COUNT(*) FROM trapper.sot_people WHERE merged_into_person_id IS NULL) as total_people,
    ROUND(100.0 *
        (SELECT COUNT(DISTINCT person_id) FROM trapper.household_members WHERE valid_to IS NULL) /
        NULLIF((SELECT COUNT(*) FROM trapper.sot_people WHERE merged_into_person_id IS NULL), 0), 1
    ) as household_coverage_pct;

\echo ''
\echo 'Soft blacklist entries:'
SELECT
    identifier_type,
    COUNT(*) as count,
    AVG(distinct_name_count)::NUMERIC(5,1) as avg_names_per_identifier
FROM trapper.data_engine_soft_blacklist
GROUP BY identifier_type;

\echo ''
\echo '=== MIG_331 Complete ==='
\echo 'Households populated from existing data.'
\echo ''
