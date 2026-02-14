\echo '=== MIG_333: Soft Invalidate Garbage People ==='
\echo 'Marks invalid people as non-canonical without deleting'
\echo ''

-- ============================================================================
-- PROBLEM
-- 450 people have garbage names (placeholders, test data, etc.)
-- These pollute identity matching and analytics.
-- We need to soft-invalidate them while preserving any linked cats/places.
-- ============================================================================

\echo 'Step 1: Preview - People with invalid names...'

SELECT
    data_quality,
    COUNT(*) as count
FROM trapper.sot_people
WHERE merged_into_person_id IS NULL
  AND NOT trapper.is_valid_person_name(display_name)
  AND NOT trapper.is_organization_name(display_name)
GROUP BY data_quality
ORDER BY count DESC;

\echo ''
\echo 'Sample invalid names:'
SELECT display_name, primary_email, data_quality
FROM trapper.sot_people
WHERE merged_into_person_id IS NULL
  AND NOT trapper.is_valid_person_name(display_name)
  AND NOT trapper.is_organization_name(display_name)
LIMIT 15;

-- ============================================================================
-- Step 2: Mark invalid people as non-canonical
-- ============================================================================

\echo ''
\echo 'Step 2: Marking invalid people as non-canonical...'

WITH updates AS (
    UPDATE trapper.sot_people
    SET is_canonical = FALSE,
        data_quality = 'garbage'
    WHERE merged_into_person_id IS NULL
      AND is_canonical = TRUE
      AND NOT trapper.is_valid_person_name(display_name)
      AND NOT trapper.is_organization_name(display_name)
    RETURNING person_id, display_name
)
SELECT COUNT(*) as people_invalidated FROM updates;

-- ============================================================================
-- Step 3: Orphan cats from invalid people (preserve place links!)
-- ============================================================================

\echo ''
\echo 'Step 3: Orphaning cats from invalid people (preserving place links)...'

-- Check what would be orphaned
SELECT
    COUNT(DISTINCT c.cat_id) as cats_to_orphan,
    COUNT(DISTINCT cpr.place_id) as places_preserved
FROM trapper.sot_cats c
JOIN trapper.sot_people p ON p.person_id = c.owner_person_id
LEFT JOIN trapper.cat_place_relationships cpr ON cpr.cat_id = c.cat_id
WHERE p.is_canonical = FALSE
  AND p.data_quality = 'garbage'
  AND c.merged_into_cat_id IS NULL;

-- Run the orphaning in batches
DO $$
DECLARE
    v_batch_size INT := 100;
    v_total INT := 0;
    v_batch INT;
BEGIN
    LOOP
        WITH to_orphan AS (
            SELECT c.cat_id
            FROM trapper.sot_cats c
            JOIN trapper.sot_people p ON p.person_id = c.owner_person_id
            WHERE p.is_canonical = FALSE
              AND p.data_quality = 'garbage'
              AND c.merged_into_cat_id IS NULL
              AND c.owner_person_id IS NOT NULL
            LIMIT v_batch_size
        ),
        orphaned AS (
            UPDATE trapper.sot_cats c
            SET owner_person_id = NULL
            FROM to_orphan
            WHERE c.cat_id = to_orphan.cat_id
            RETURNING c.cat_id
        )
        SELECT COUNT(*) INTO v_batch FROM orphaned;

        v_total := v_total + v_batch;
        EXIT WHEN v_batch < v_batch_size;
    END LOOP;

    RAISE NOTICE 'Orphaned % cats from invalid people', v_total;
END $$;

-- ============================================================================
-- Step 4: Log the cleanup
-- ============================================================================

\echo ''
\echo 'Step 4: Logging cleanup...'

INSERT INTO trapper.data_changes (
    operation,
    record_type,
    record_count,
    notes,
    changed_by
)
SELECT
    'soft_invalidate',
    'people',
    COUNT(*),
    'MIG_333: Marked invalid/garbage people as non-canonical',
    'migration'
FROM trapper.sot_people
WHERE data_quality = 'garbage';

-- ============================================================================
-- Step 5: Summary
-- ============================================================================

\echo ''
\echo '=== Summary ==='

SELECT
    'Total active people' as metric,
    COUNT(*)::TEXT as value
FROM trapper.sot_people WHERE merged_into_person_id IS NULL

UNION ALL

SELECT
    'Canonical people',
    COUNT(*)::TEXT
FROM trapper.sot_people WHERE merged_into_person_id IS NULL AND is_canonical = TRUE

UNION ALL

SELECT
    'Non-canonical (garbage)',
    COUNT(*)::TEXT
FROM trapper.sot_people WHERE merged_into_person_id IS NULL AND data_quality = 'garbage'

UNION ALL

SELECT
    'Cats with valid owners',
    COUNT(*)::TEXT
FROM trapper.sot_cats c
JOIN trapper.sot_people p ON p.person_id = c.owner_person_id
WHERE c.merged_into_cat_id IS NULL
  AND p.merged_into_person_id IS NULL
  AND p.is_canonical = TRUE

UNION ALL

SELECT
    'Cats with place links',
    COUNT(DISTINCT c.cat_id)::TEXT
FROM trapper.cat_place_relationships cpr
JOIN trapper.sot_cats c ON c.cat_id = cpr.cat_id
WHERE c.merged_into_cat_id IS NULL;

\echo ''
\echo '=== MIG_333 Complete ==='
\echo 'Invalid people marked as non-canonical, cats orphaned but place links preserved.'
\echo ''
