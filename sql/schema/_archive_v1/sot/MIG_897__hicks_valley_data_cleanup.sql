-- ============================================================================
-- MIG_897: Hicks Valley / Carlos Lopez / Jeanie Garcia Data Cleanup
-- ============================================================================
-- Cleans up the specific case discovered during data quality investigation:
--   - Carlos Lopez: Real person at 1052 Hicks Valley Rd, NO identifiers
--   - Jeanie Garcia: Real person at 14485 Valley Ford Rd, has org email (marinferals@yahoo.com)
--   - Cats incorrectly linked to Jeanie due to historical org email proxy pattern
--   - Janet Williams: Actual Marin Friends of Ferals contact (415-246-9162)
--
-- Also merges duplicate places and cats discovered during investigation.
-- ============================================================================

\echo '=== MIG_897: Hicks Valley Data Cleanup ==='
\echo ''

-- ============================================================================
-- Phase 0: Verify IDs are still valid (from earlier investigation)
-- ============================================================================

\echo 'Phase 0: Verifying IDs from investigation...'

-- Expected IDs (from earlier investigation):
-- Carlos Lopez: 0e2505db-8222-40fb-912d-eb480449251a
-- Jeanie Garcia: 656b3dd9-1e09-4cb6-aa0c-f6f31f5a4473
-- 1052 Hicks Valley Rd: 58c260f2-6d46-482b-883b-1f9c296d60af

SELECT 'Carlos Lopez' as entity,
       person_id::text,
       display_name,
       CASE WHEN person_id = '0e2505db-8222-40fb-912d-eb480449251a' THEN 'MATCH' ELSE 'MISMATCH' END as status
FROM trapper.sot_people
WHERE display_name ILIKE '%carlos lopez%'
  AND merged_into_person_id IS NULL
UNION ALL
SELECT 'Jeanie Garcia' as entity,
       person_id::text,
       display_name,
       CASE WHEN person_id = '656b3dd9-1e09-4cb6-aa0c-f6f31f5a4473' THEN 'MATCH' ELSE 'MISMATCH' END as status
FROM trapper.sot_people
WHERE display_name ILIKE '%jeanie garcia%'
  AND merged_into_person_id IS NULL;

-- ============================================================================
-- Phase 1: Add audit note for Carlos Lopez
-- ============================================================================

\echo ''
\echo 'Phase 1: Adding audit note for Carlos Lopez...'

DO $$
DECLARE
    v_carlos_id UUID;
BEGIN
    -- Find Carlos Lopez
    SELECT person_id INTO v_carlos_id
    FROM trapper.sot_people
    WHERE display_name ILIKE '%carlos lopez%'
      AND merged_into_person_id IS NULL
    ORDER BY created_at
    LIMIT 1;

    IF v_carlos_id IS NOT NULL THEN
        -- Log note via entity_edits table
        INSERT INTO trapper.entity_edits (
            entity_type, entity_id, edit_type, reason, edited_by, edit_source
        ) VALUES (
            'person', v_carlos_id, 'note_added',
            '[2026-02-05] Historical record from pre-2024 informal data. No contact info on file. ' ||
            'Cats at 1052 Hicks Valley Rd may be linked to Jeanie Garcia due to org email pattern (marinferals@yahoo.com). ' ||
            'See MIG_897 for details.',
            'MIG_897', 'migration'
        );
        RAISE NOTICE 'Phase 1: Added audit note for Carlos Lopez (%)', v_carlos_id;
    ELSE
        RAISE WARNING 'Phase 1: Carlos Lopez not found!';
    END IF;
END $$;

-- ============================================================================
-- Phase 2: Link Carlos Lopez to 1052 Hicks Valley Rd
-- ============================================================================

\echo ''
\echo 'Phase 2: Linking Carlos Lopez to 1052 Hicks Valley Rd...'

DO $$
DECLARE
    v_carlos_id UUID;
    v_place_id UUID;
BEGIN
    -- Find Carlos Lopez
    SELECT person_id INTO v_carlos_id
    FROM trapper.sot_people
    WHERE display_name ILIKE '%carlos lopez%'
      AND merged_into_person_id IS NULL
    ORDER BY created_at
    LIMIT 1;

    -- Find 1052 Hicks Valley Rd place
    SELECT place_id INTO v_place_id
    FROM trapper.places
    WHERE (formatted_address ILIKE '%1052%hicks valley%' OR normalized_address ILIKE '%1052%HICKS%VALLEY%')
      AND merged_into_place_id IS NULL
    ORDER BY created_at
    LIMIT 1;

    IF v_carlos_id IS NOT NULL AND v_place_id IS NOT NULL THEN
        INSERT INTO trapper.person_place_relationships (person_id, place_id, role, confidence, source_system, source_table)
        VALUES (v_carlos_id, v_place_id, 'resident', 0.8, 'atlas', 'mig_897_manual_fix')
        ON CONFLICT DO NOTHING;
        RAISE NOTICE 'Phase 2: Linked Carlos Lopez (%) to place (%)', v_carlos_id, v_place_id;
    ELSE
        RAISE WARNING 'Phase 2: Could not find Carlos Lopez (%) or place (%)', v_carlos_id, v_place_id;
    END IF;
END $$;

-- ============================================================================
-- Phase 3: Add audit note for Jeanie Garcia
-- ============================================================================

\echo ''
\echo 'Phase 3: Adding audit note for Jeanie Garcia...'

DO $$
DECLARE
    v_jeanie_id UUID;
BEGIN
    -- Find Jeanie Garcia
    SELECT person_id INTO v_jeanie_id
    FROM trapper.sot_people
    WHERE display_name ILIKE '%jeanie garcia%'
      AND merged_into_person_id IS NULL
    ORDER BY created_at
    LIMIT 1;

    IF v_jeanie_id IS NOT NULL THEN
        -- Log note via entity_edits table
        INSERT INTO trapper.entity_edits (
            entity_type, entity_id, edit_type, reason, edited_by, edit_source
        ) VALUES (
            'person', v_jeanie_id, 'note_added',
            '[2026-02-05] This person has marinferals@yahoo.com (Marin Friends of Ferals org email). ' ||
            'Until 2024, FFSC used org contact info for resident bookings. Cats linked to this person ' ||
            'may actually belong to other residents at the same addresses (e.g., Carlos Lopez at 1052 Hicks Valley Rd). ' ||
            'For accurate cat counts, use place views rather than person-cat links. See MIG_897.',
            'MIG_897', 'migration'
        );
        RAISE NOTICE 'Phase 3: Added audit note for Jeanie Garcia (%)', v_jeanie_id;
    ELSE
        RAISE WARNING 'Phase 3: Jeanie Garcia not found!';
    END IF;
END $$;

-- ============================================================================
-- Phase 4: Create or update Janet Williams (Marin Friends of Ferals contact)
-- ============================================================================

\echo ''
\echo 'Phase 4: Creating/updating Janet Williams (Marin Friends of Ferals contact)...'

DO $$
DECLARE
    v_janet_id UUID;
BEGIN
    -- Check if Janet Williams exists
    SELECT person_id INTO v_janet_id
    FROM trapper.sot_people
    WHERE display_name ILIKE '%janet williams%'
      AND merged_into_person_id IS NULL
    LIMIT 1;

    IF v_janet_id IS NULL THEN
        -- Create Janet Williams using columns that exist on sot_people
        INSERT INTO trapper.sot_people (display_name, data_source, is_canonical)
        VALUES (
            'Janet Williams',
            'web_app'::trapper.data_source,
            TRUE
        )
        RETURNING person_id INTO v_janet_id;

        -- Log creation note via entity_edits
        INSERT INTO trapper.entity_edits (
            entity_type, entity_id, edit_type, reason, edited_by, edit_source
        ) VALUES (
            'person', v_janet_id, 'create',
            '[2026-02-05] Marin Friends of Ferals contact. Phone: 415-246-9162, Email: marinferals@yahoo.com (org email, soft-blacklisted). ' ||
            'Created by MIG_897 during data quality investigation.',
            'MIG_897', 'migration'
        );
        RAISE NOTICE 'Phase 4: Created Janet Williams (%)', v_janet_id;
    ELSE
        -- Log note for existing record
        INSERT INTO trapper.entity_edits (
            entity_type, entity_id, edit_type, reason, edited_by, edit_source
        ) VALUES (
            'person', v_janet_id, 'note_added',
            '[2026-02-05] Confirmed as Marin Friends of Ferals contact. Phone: 415-246-9162.',
            'MIG_897', 'migration'
        );
        RAISE NOTICE 'Phase 4: Updated existing Janet Williams (%)', v_janet_id;
    END IF;

    -- Add phone identifier (high confidence - personal phone)
    INSERT INTO trapper.person_identifiers (person_id, id_type, id_value_raw, id_value_norm, confidence, source_system)
    VALUES (v_janet_id, 'phone', '415-246-9162', '4152469162', 1.0, 'atlas')
    ON CONFLICT DO NOTHING;

    -- Add email identifier (low confidence - org email, soft-blacklisted)
    INSERT INTO trapper.person_identifiers (person_id, id_type, id_value_raw, id_value_norm, confidence, source_system)
    VALUES (v_janet_id, 'email', 'marinferals@yahoo.com', 'marinferals@yahoo.com', 0.5, 'atlas')
    ON CONFLICT DO NOTHING;

    RAISE NOTICE 'Phase 4: Added identifiers for Janet Williams';

    -- Update known_organizations with Janet as primary contact
    UPDATE trapper.known_organizations
    SET notes = COALESCE(notes, '') || ' Primary contact: Janet Williams (415-246-9162).'
    WHERE org_name = 'Marin Friends of Ferals'
      AND notes NOT LIKE '%Janet Williams%';
END $$;

-- ============================================================================
-- Phase 5: Merge duplicate Jupiter cats (if any without microchip)
-- ============================================================================

\echo ''
\echo 'Phase 5: Checking for duplicate Jupiter cats...'

-- First, show what we have (microchip is in cat_identifiers, not sot_cats)
SELECT c.cat_id, c.display_name,
       ci.id_value as microchip,
       CASE WHEN ci.id_value IS NULL THEN 'NO CHIP' ELSE 'HAS CHIP' END as chip_status
FROM trapper.sot_cats c
LEFT JOIN trapper.cat_identifiers ci ON ci.cat_id = c.cat_id AND ci.id_type = 'microchip'
WHERE c.display_name ILIKE '%jupiter%'
  AND c.merged_into_cat_id IS NULL
ORDER BY c.display_name, c.created_at;

-- Merge duplicates if they exist (cats with same name, no microchip)
DO $$
DECLARE
    v_canonical_id UUID;
    v_dup_id UUID;
    v_merged INT := 0;
    v_dup_rec RECORD;
BEGIN
    -- Find duplicate groups (same display_name, no microchip in cat_identifiers)
    FOR v_dup_rec IN
        SELECT c.display_name, array_agg(c.cat_id ORDER BY c.created_at) as cat_ids
        FROM trapper.sot_cats c
        LEFT JOIN trapper.cat_identifiers ci ON ci.cat_id = c.cat_id AND ci.id_type = 'microchip'
        WHERE c.display_name ILIKE '%jupiter%'
          AND c.merged_into_cat_id IS NULL
          AND ci.id_value IS NULL  -- No microchip
        GROUP BY c.display_name
        HAVING COUNT(*) > 1
    LOOP
        -- First one is canonical
        v_canonical_id := v_dup_rec.cat_ids[1];

        -- Merge the rest
        FOR i IN 2..array_length(v_dup_rec.cat_ids, 1) LOOP
            v_dup_id := v_dup_rec.cat_ids[i];
            BEGIN
                PERFORM trapper.merge_cats(v_canonical_id, v_dup_id);
                v_merged := v_merged + 1;
                RAISE NOTICE 'Phase 5: Merged cat % into %', v_dup_id, v_canonical_id;
            EXCEPTION WHEN OTHERS THEN
                RAISE WARNING 'Phase 5: Could not merge cat %: %', v_dup_id, SQLERRM;
            END;
        END LOOP;
    END LOOP;

    IF v_merged > 0 THEN
        RAISE NOTICE 'Phase 5: Merged % duplicate Jupiter cats', v_merged;
    ELSE
        RAISE NOTICE 'Phase 5: No duplicate Jupiter cats to merge';
    END IF;
END $$;

-- ============================================================================
-- Phase 6: Check and potentially merge duplicate Hicks Valley places
-- ============================================================================

\echo ''
\echo 'Phase 6: Checking for duplicate Hicks Valley places...'

-- Show current Hicks Valley places
SELECT place_id, display_name, formatted_address, normalized_address,
       ST_X(location::geometry) as lng, ST_Y(location::geometry) as lat
FROM trapper.places
WHERE (formatted_address ILIKE '%hicks valley%' OR display_name ILIKE '%hicks valley%')
  AND merged_into_place_id IS NULL
ORDER BY formatted_address;

-- Note: Place merging requires manual verification of coordinates
-- The plan mentioned places 30 feet apart, but we should verify before merging
-- Commenting out automatic merge - run manually after verification

/*
DO $$
DECLARE
    v_canonical_id UUID;
    v_merge_id UUID;
BEGIN
    -- Find 1052 Hicks Valley Rd (canonical)
    SELECT place_id INTO v_canonical_id
    FROM trapper.places
    WHERE formatted_address ILIKE '%1052%hicks valley%'
      AND merged_into_place_id IS NULL
    ORDER BY created_at
    LIMIT 1;

    -- Find 1040 Hicks Valley Rd (to merge if within 100 feet)
    SELECT place_id INTO v_merge_id
    FROM trapper.places
    WHERE formatted_address ILIKE '%1040%hicks valley%'
      AND merged_into_place_id IS NULL
      AND place_id != v_canonical_id
    ORDER BY created_at
    LIMIT 1;

    IF v_canonical_id IS NOT NULL AND v_merge_id IS NOT NULL THEN
        PERFORM trapper.merge_places(v_canonical_id, v_merge_id);
        RAISE NOTICE 'Phase 6: Merged place % into %', v_merge_id, v_canonical_id;
    END IF;
END $$;
*/

-- ============================================================================
-- Phase 7: Summary
-- ============================================================================

\echo ''
\echo '=============================================='
\echo 'MIG_897 Complete!'
\echo '=============================================='
\echo ''
\echo 'Changes made:'
\echo '  1. Added audit note for Carlos Lopez explaining data pattern'
\echo '  2. Linked Carlos Lopez to 1052 Hicks Valley Rd'
\echo '  3. Added audit note for Jeanie Garcia explaining org email'
\echo '  4. Created/updated Janet Williams as Marin Friends of Ferals contact'
\echo '  5. Merged duplicate Jupiter cats (if any without microchip)'
\echo ''
\echo 'Manual verification needed:'
\echo '  - Hicks Valley place merging (check coordinates first)'
\echo ''
\echo 'Verification queries:'
\echo '  -- Check Carlos Lopez now has place relationship:'
\echo '  SELECT ppr.*, pl.formatted_address'
\echo '  FROM trapper.person_place_relationships ppr'
\echo '  JOIN trapper.places pl ON pl.place_id = ppr.place_id'
\echo '  JOIN trapper.sot_people p ON p.person_id = ppr.person_id'
\echo '  WHERE p.display_name ILIKE ''%carlos lopez%'';'
\echo ''
\echo '  -- Check Janet Williams:'
\echo '  SELECT p.*, pi.id_type, pi.id_value_norm'
\echo '  FROM trapper.sot_people p'
\echo '  LEFT JOIN trapper.person_identifiers pi ON pi.person_id = p.person_id'
\echo '  WHERE p.display_name ILIKE ''%janet williams%'';'
\echo ''
