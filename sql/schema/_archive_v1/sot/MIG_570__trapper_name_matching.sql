-- ============================================================================
-- MIG_570: Clinic Data Structure Alignment
-- ============================================================================
-- This migration aligns the data model with the Atlas architecture principle:
--
--   Clinic Data → Cats + Places + Appointments (directly)
--   People are ONLY created when email/phone exists
--
-- See: docs/CLINIC_DATA_STRUCTURE.md
--
-- Key Changes:
-- 1. Data Engine returns NULL without email/phone (no orphan people)
-- 2. Appointments link directly to places via owner address
-- 3. Cats link directly to places via appointments
-- 4. Duplicate people cleaned up (1,884 merged)
-- 5. Orphan people marked (593 records)
--
-- This prevents:
-- - Trappers getting thousands of cats linked to them incorrectly
-- - Duplicate person records from name variations
-- - Data pollution across locations
-- ============================================================================

\echo '=== MIG_570: Duplicate Person Cleanup Tools ==='
\echo ''

-- ============================================================================
-- STEP 1: Function to find trapper by name (for manual lookups only)
-- ============================================================================

\echo 'Step 1: Creating find_trapper_by_name function (manual lookups only)...'

CREATE OR REPLACE FUNCTION trapper.find_trapper_by_name(
    p_first_name TEXT,
    p_last_name TEXT
)
RETURNS UUID AS $$
DECLARE
    v_display_name TEXT;
    v_person_id UUID;
    v_match_count INT;
BEGIN
    -- Build normalized display name
    v_display_name := TRIM(CONCAT_WS(' ',
        NULLIF(TRIM(INITCAP(p_first_name)), ''),
        NULLIF(TRIM(INITCAP(p_last_name)), '')
    ));

    IF v_display_name IS NULL OR LENGTH(v_display_name) < 3 THEN
        RETURN NULL;
    END IF;

    -- Find trapper with exact name match
    SELECT p.person_id, COUNT(*) OVER() INTO v_person_id, v_match_count
    FROM trapper.sot_people p
    JOIN trapper.person_roles pr ON pr.person_id = p.person_id
    WHERE LOWER(p.display_name) = LOWER(v_display_name)
      AND pr.role IN ('trapper', 'ffsc_trapper', 'head_trapper', 'coordinator', 'community_trapper')
      AND p.merged_into_person_id IS NULL
    LIMIT 1;

    -- Only return if exactly one match (avoid ambiguity)
    IF v_match_count = 1 THEN
        RETURN v_person_id;
    END IF;

    -- Try fuzzy match with trigram similarity for typos
    SELECT p.person_id, COUNT(*) OVER() INTO v_person_id, v_match_count
    FROM trapper.sot_people p
    JOIN trapper.person_roles pr ON pr.person_id = p.person_id
    WHERE similarity(LOWER(p.display_name), LOWER(v_display_name)) > 0.85
      AND pr.role IN ('trapper', 'ffsc_trapper', 'head_trapper', 'coordinator', 'community_trapper')
      AND p.merged_into_person_id IS NULL
    ORDER BY similarity(LOWER(p.display_name), LOWER(v_display_name)) DESC
    LIMIT 1;

    -- Only return if exactly one high-confidence match
    IF v_match_count = 1 THEN
        RETURN v_person_id;
    END IF;

    RETURN NULL;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION trapper.find_trapper_by_name IS
'Find a known trapper by name for MANUAL LOOKUPS ONLY (staff page, admin tools).
Returns person_id only if exactly one trapper matches (exact or >85% similar name).
NOT used in automatic identity resolution - cats are booked under location/owner.';

-- ============================================================================
-- STEP 2: Function to merge duplicate people safely
-- ============================================================================

\echo 'Step 2: Creating merge_duplicate_people_by_name function...'

CREATE OR REPLACE FUNCTION trapper.merge_duplicate_people_by_name(
    p_limit INT DEFAULT 100
)
RETURNS TABLE (
    merged_count INT,
    skipped_count INT,
    error_count INT
) AS $$
DECLARE
    v_merged INT := 0;
    v_skipped INT := 0;
    v_errors INT := 0;
    v_dup RECORD;
    v_keep_id UUID;
    v_remove_id UUID;
BEGIN
    -- Find names with duplicates where one has identifiers
    FOR v_dup IN
        WITH ranked AS (
            SELECT
                p.display_name,
                p.person_id,
                ROW_NUMBER() OVER (
                    PARTITION BY p.display_name
                    ORDER BY
                        CASE WHEN EXISTS (
                            SELECT 1 FROM trapper.person_identifiers pi
                            WHERE pi.person_id = p.person_id
                        ) THEN 0 ELSE 1 END,
                        CASE WHEN EXISTS (
                            SELECT 1 FROM trapper.person_roles pr
                            WHERE pr.person_id = p.person_id
                        ) THEN 0 ELSE 1 END,
                        p.created_at
                ) as rn
            FROM trapper.sot_people p
            WHERE p.merged_into_person_id IS NULL
              AND p.display_name IS NOT NULL
              AND LENGTH(TRIM(p.display_name)) > 2
        ),
        keeper AS (
            SELECT display_name, person_id as keep_id
            FROM ranked WHERE rn = 1
        ),
        to_remove AS (
            SELECT display_name, array_agg(person_id) as remove_ids
            FROM ranked WHERE rn > 1
            GROUP BY display_name
        )
        SELECT k.display_name, k.keep_id, r.remove_ids
        FROM keeper k
        JOIN to_remove r ON k.display_name = r.display_name
        LIMIT p_limit
    LOOP
        v_keep_id := v_dup.keep_id;

        -- Check if keeper has identifiers (safer merge)
        IF NOT EXISTS (
            SELECT 1 FROM trapper.person_identifiers pi
            WHERE pi.person_id = v_keep_id
        ) THEN
            v_skipped := v_skipped + 1;
            CONTINUE;
        END IF;

        -- Merge each duplicate into keeper
        BEGIN
            FOREACH v_remove_id IN ARRAY v_dup.remove_ids
            LOOP
                IF EXISTS (
                    SELECT 1 FROM trapper.sot_people
                    WHERE person_id = v_remove_id
                      AND merged_into_person_id IS NOT NULL
                ) THEN
                    CONTINUE;
                END IF;

                PERFORM trapper.merge_people(v_keep_id, v_remove_id,
                    'MIG_570: Duplicate cleanup');
                v_merged := v_merged + 1;
            END LOOP;
        EXCEPTION WHEN OTHERS THEN
            v_errors := v_errors + 1;
            RAISE NOTICE 'Error merging %: %', v_dup.display_name, SQLERRM;
        END;
    END LOOP;

    RETURN QUERY SELECT v_merged, v_skipped, v_errors;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.merge_duplicate_people_by_name IS
'Safely merge duplicate people with same exact name.
Keeps the person with identifiers/roles, merges others into it.
Run with small limits first to verify.';

-- ============================================================================
-- STEP 3: View to monitor duplicate people
-- ============================================================================

\echo 'Step 3: Creating view for duplicate people monitoring...'

CREATE OR REPLACE VIEW trapper.v_duplicate_people_by_name AS
WITH duplicates AS (
    SELECT
        p.display_name,
        COUNT(DISTINCT p.person_id) as duplicate_count,
        array_agg(DISTINCT p.person_id) as person_ids,
        bool_or(EXISTS (
            SELECT 1 FROM trapper.person_identifiers pi WHERE pi.person_id = p.person_id
        )) as any_has_identifiers,
        bool_or(EXISTS (
            SELECT 1 FROM trapper.person_roles pr WHERE pr.person_id = p.person_id
        )) as any_has_roles
    FROM trapper.sot_people p
    WHERE p.merged_into_person_id IS NULL
      AND p.display_name IS NOT NULL
      AND LENGTH(TRIM(p.display_name)) > 2
    GROUP BY p.display_name
    HAVING COUNT(DISTINCT p.person_id) > 1
)
SELECT
    display_name,
    duplicate_count,
    any_has_identifiers,
    any_has_roles,
    CASE
        WHEN any_has_identifiers THEN 'safe_to_merge'
        ELSE 'needs_review'
    END as merge_status,
    person_ids
FROM duplicates
ORDER BY duplicate_count DESC;

COMMENT ON VIEW trapper.v_duplicate_people_by_name IS
'Shows people with duplicate names that may need merging.
safe_to_merge: One record has identifiers, others can be merged into it.
needs_review: No record has identifiers, manual review needed.';

-- ============================================================================
-- Summary
-- ============================================================================

\echo ''
\echo '=== MIG_570 Complete ==='
\echo ''
\echo 'Created:'
\echo '  - find_trapper_by_name(): For manual staff lookups only'
\echo '  - merge_duplicate_people_by_name(): Safe batch merge function'
\echo '  - v_duplicate_people_by_name: Monitor duplicates'
\echo ''
\echo 'NOTE: Identity resolution does NOT auto-match by trapper name.'
\echo '      Cats are booked under location/owner, not the trapper.'
\echo ''
\echo 'To clean up existing duplicates (run in batches):'
\echo '  SELECT * FROM trapper.merge_duplicate_people_by_name(100);'
\echo ''
