-- =====================================================
-- MIG_548: Merge Heather Singkeo Duplicate Records
-- =====================================================
-- Problem: Multiple person records exist for Heather Singkeo
-- Solution: Identify canonical record and merge duplicates using merge_people()
--
-- MANUAL APPLY:
--   psql "$DATABASE_URL" -f sql/schema/sot/MIG_548__merge_heather_singkeo_duplicates.sql
-- =====================================================

\echo '=== MIG_548: Merge Heather Singkeo Duplicates ==='
\echo ''

-- ============================================================
-- 1. Identify all Heather Singkeo records
-- ============================================================

\echo 'Step 1: Identifying all Heather Singkeo records...'

CREATE TEMP TABLE heather_duplicates AS
SELECT
    p.person_id,
    p.display_name,
    (SELECT pi.id_value_raw FROM trapper.person_identifiers pi WHERE pi.person_id = p.person_id AND pi.id_type = 'email' LIMIT 1) as email,
    (SELECT pi.id_value_raw FROM trapper.person_identifiers pi WHERE pi.person_id = p.person_id AND pi.id_type = 'phone' LIMIT 1) as phone,
    p.created_at,
    p.merged_into_person_id,
    -- Count identifiers
    (SELECT COUNT(*) FROM trapper.person_identifiers pi WHERE pi.person_id = p.person_id) as identifier_count,
    -- Count relationships
    (SELECT COUNT(*) FROM trapper.person_cat_relationships pcr WHERE pcr.person_id = p.person_id) as cat_rel_count,
    (SELECT COUNT(*) FROM trapper.person_place_relationships ppr WHERE ppr.person_id = p.person_id) as place_rel_count,
    (SELECT COUNT(*) FROM trapper.sot_requests r WHERE r.requester_person_id = p.person_id) as request_count,
    (SELECT COUNT(*) FROM trapper.sot_appointments a WHERE a.person_id = p.person_id) as appointment_count
FROM trapper.sot_people p
WHERE p.merged_into_person_id IS NULL  -- Only non-merged records
  AND (
    p.display_name ILIKE '%heather%singkeo%'
    OR (p.first_name ILIKE 'heather' AND p.last_name ILIKE 'singkeo')
    OR EXISTS (
      SELECT 1 FROM trapper.person_identifiers pi
      WHERE pi.person_id = p.person_id AND pi.id_type = 'email' AND pi.id_value_raw ILIKE '%singkeo%'
    )
  );

\echo 'Heather Singkeo records found:'
SELECT * FROM heather_duplicates ORDER BY identifier_count DESC, cat_rel_count DESC, created_at ASC;

-- ============================================================
-- 2. Identify canonical record (most data, earliest)
-- ============================================================

\echo ''
\echo 'Step 2: Selecting canonical record...'

-- Canonical = highest total score (identifiers + relationships weighted)
CREATE TEMP TABLE heather_canonical AS
SELECT person_id
FROM heather_duplicates
ORDER BY
    (identifier_count * 3 + cat_rel_count * 2 + place_rel_count + request_count + appointment_count) DESC,
    created_at ASC
LIMIT 1;

\echo 'Canonical record:'
SELECT hd.* FROM heather_duplicates hd
JOIN heather_canonical hc ON hc.person_id = hd.person_id;

-- ============================================================
-- 3. Merge non-canonical records into canonical
-- ============================================================

\echo ''
\echo 'Step 3: Merging duplicates into canonical...'

DO $$
DECLARE
    v_canonical_id UUID;
    v_source_id UUID;
    v_result JSONB;
    v_merge_count INT := 0;
    v_dup_count INT;
BEGIN
    -- Get canonical ID
    SELECT person_id INTO v_canonical_id FROM heather_canonical;

    IF v_canonical_id IS NULL THEN
        RAISE NOTICE 'No canonical Heather Singkeo record found - nothing to merge';
        RETURN;
    END IF;

    -- Count duplicates to merge
    SELECT COUNT(*) - 1 INTO v_dup_count FROM heather_duplicates;
    RAISE NOTICE 'Found canonical person_id: %. Will merge % duplicate(s).', v_canonical_id, v_dup_count;

    -- Merge all non-canonical records
    FOR v_source_id IN
        SELECT person_id FROM heather_duplicates
        WHERE person_id <> v_canonical_id
        ORDER BY created_at ASC
    LOOP
        BEGIN
            SELECT trapper.merge_people(
                v_source_id,
                v_canonical_id,
                'duplicate_heather_singkeo_cleanup_MIG_548',
                'MIG_548_automated'
            ) INTO v_result;

            v_merge_count := v_merge_count + 1;
            RAISE NOTICE 'Merged % into % - Result: %', v_source_id, v_canonical_id, v_result;

        EXCEPTION WHEN OTHERS THEN
            RAISE WARNING 'Failed to merge %: %', v_source_id, SQLERRM;
        END;
    END LOOP;

    RAISE NOTICE 'Total merges completed: %', v_merge_count;
END $$;

DROP TABLE heather_canonical;
DROP TABLE heather_duplicates;

-- ============================================================
-- 4. Verification
-- ============================================================

\echo ''
\echo '====== VERIFICATION ======'

\echo ''
\echo 'Remaining Heather Singkeo records (should be 1):'
SELECT
    p.person_id,
    p.display_name,
    (SELECT pi.id_value_raw FROM trapper.person_identifiers pi WHERE pi.person_id = p.person_id AND pi.id_type = 'email' LIMIT 1) as email,
    (SELECT pi.id_value_raw FROM trapper.person_identifiers pi WHERE pi.person_id = p.person_id AND pi.id_type = 'phone' LIMIT 1) as phone,
    (SELECT COUNT(*) FROM trapper.person_cat_relationships pcr WHERE pcr.person_id = p.person_id) as cat_relationships,
    (SELECT COUNT(*) FROM trapper.person_identifiers pi WHERE pi.person_id = p.person_id) as identifiers,
    (SELECT COUNT(*) FROM trapper.sot_appointments a WHERE a.person_id = p.person_id) as appointments
FROM trapper.sot_people p
WHERE p.merged_into_person_id IS NULL
  AND (
    p.display_name ILIKE '%heather%singkeo%'
    OR EXISTS (
      SELECT 1 FROM trapper.person_identifiers pi
      WHERE pi.person_id = p.person_id AND pi.id_type = 'email' AND pi.id_value_raw ILIKE '%singkeo%'
    )
  );

\echo ''
\echo 'Merged Heather Singkeo records:'
SELECT person_id, display_name, merged_into_person_id, merge_reason
FROM trapper.sot_people p
WHERE p.merged_into_person_id IS NOT NULL
  AND (
    p.display_name ILIKE '%heather%singkeo%'
    OR EXISTS (
      SELECT 1 FROM trapper.person_identifiers pi
      WHERE pi.person_id = p.person_id AND pi.id_type = 'email' AND pi.id_value_raw ILIKE '%singkeo%'
    )
  );

\echo ''
\echo 'Heather cat relationships (should be consolidated):'
SELECT
    pcr.relationship_type,
    COUNT(*) as count,
    COUNT(DISTINCT pcr.cat_id) as unique_cats
FROM trapper.person_cat_relationships pcr
JOIN trapper.sot_people p ON p.person_id = pcr.person_id
WHERE p.merged_into_person_id IS NULL
  AND (
    p.display_name ILIKE '%heather%singkeo%'
    OR EXISTS (
      SELECT 1 FROM trapper.person_identifiers pi
      WHERE pi.person_id = p.person_id AND pi.id_type = 'email' AND pi.id_value_raw ILIKE '%singkeo%'
    )
  )
GROUP BY pcr.relationship_type;

\echo ''
\echo '=== MIG_548 Complete ==='
