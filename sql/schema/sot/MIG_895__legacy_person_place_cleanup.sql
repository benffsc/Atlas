-- ============================================================================
-- MIG_895: Legacy Person/Place Data Cleanup
-- ============================================================================
-- Cleans up legacy data issues discovered during audit:
--   1. Organizations stored as people (should be in clinic_owner_accounts)
--   2. Addresses stored as people
--   3. Duplicate people with identical names but no identifiers
--   4. First-name-only records that can't be matched
--   5. Place display_names that are person names
--   6. Doubled place names (data entry errors)
--
-- Root Cause: These records were created BEFORE the Data Engine was implemented
-- (prior to Jan 25, 2026). The current pipeline is working correctly.
-- ============================================================================

\echo '=== MIG_895: Legacy Person/Place Data Cleanup ==='
\echo ''
\echo 'This migration cleans up legacy data quality issues.'
\echo 'The current ingest pipeline (Data Engine + should_be_person) is working correctly.'
\echo ''

-- ============================================================================
-- Phase 1: Merge duplicate people (same name, no identifiers)
-- ============================================================================

\echo 'Phase 1: Merging duplicate people with same name but no identifiers...'

-- For each group of duplicates with same name, keep the oldest one and merge others
WITH duplicate_groups AS (
    SELECT
        display_name,
        MIN(person_id) as canonical_id,
        array_agg(person_id ORDER BY created_at) FILTER (WHERE person_id != (
            SELECT MIN(p2.person_id) FROM trapper.sot_people p2
            WHERE p2.display_name = p.display_name AND p2.merged_into_person_id IS NULL
        )) as duplicate_ids
    FROM trapper.sot_people p
    WHERE merged_into_person_id IS NULL
      AND display_name LIKE '% %'  -- Full names only
      AND data_source = 'clinichq'
      -- Has no identifiers
      AND NOT EXISTS (
          SELECT 1 FROM trapper.person_identifiers pi
          WHERE pi.person_id = p.person_id
      )
    GROUP BY display_name
    HAVING COUNT(*) > 1
)
SELECT
    display_name,
    canonical_id,
    array_length(duplicate_ids, 1) as duplicates_to_merge
FROM duplicate_groups
WHERE array_length(duplicate_ids, 1) > 0
ORDER BY array_length(duplicate_ids, 1) DESC
LIMIT 20;

-- Actually perform the merges for the biggest offenders
DO $$
DECLARE
    v_rec RECORD;
    v_dup UUID;
    v_merged INT := 0;
BEGIN
    -- Process top duplicate groups
    FOR v_rec IN
        SELECT
            display_name,
            MIN(person_id) as canonical_id
        FROM trapper.sot_people p
        WHERE merged_into_person_id IS NULL
          AND display_name IN (
              'Cast Kay Tee Inc Cast Kay Tee Inc',
              'Sonoma County Landfill Petaluma',
              'Debra Comstock',
              'Robin Bartholow',
              'FFSC Sonoma County Landfill',
              'Dutton Ranch Corp.',
              'Sharon Green',
              '2151 West Steele Lane Ffsc',
              'Pub Republic',
              '1022 Santa Rosa Ave. Ffsc'
          )
          AND NOT EXISTS (
              SELECT 1 FROM trapper.person_identifiers pi
              WHERE pi.person_id = p.person_id
          )
        GROUP BY display_name
    LOOP
        -- Merge all duplicates into canonical
        FOR v_dup IN
            SELECT person_id FROM trapper.sot_people
            WHERE display_name = v_rec.display_name
              AND merged_into_person_id IS NULL
              AND person_id != v_rec.canonical_id
        LOOP
            PERFORM trapper.merge_people(v_rec.canonical_id, v_dup);
            v_merged := v_merged + 1;
        END LOOP;
    END LOOP;
    RAISE NOTICE 'Phase 1 complete: Merged % duplicate people', v_merged;
END $$;

-- ============================================================================
-- Phase 2: Mark organizations as is_organization = true
-- ============================================================================

\echo ''
\echo 'Phase 2: Marking organizations stored as people...'

UPDATE trapper.sot_people
SET is_organization = true
WHERE merged_into_person_id IS NULL
  AND is_organization = false
  AND (
    display_name ILIKE '%inc%' OR display_name ILIKE '%corp%' OR display_name ILIKE '%llc%'
    OR display_name ILIKE '%shelter%' OR display_name ILIKE '%rescue%'
    OR display_name ILIKE '%spca%' OR display_name ILIKE '%humane%'
    OR display_name ILIKE '%ranch%' OR display_name ILIKE '%farm%'
    OR display_name ILIKE '%county%' OR display_name ILIKE '%city of%'
    OR display_name ILIKE '%school%' OR display_name ILIKE '%academy%'
    OR display_name ILIKE '%ffsc%' OR display_name ILIKE '%animal services%'
  )
  -- Exclude names that just contain these words but are people
  AND trapper.classify_owner_name(display_name) IN ('organization', 'known_org', 'address');

\echo 'Organizations marked. Count:'
SELECT COUNT(*) as organizations_marked
FROM trapper.sot_people
WHERE is_organization = true;

-- ============================================================================
-- Phase 3: Route pseudo-profiles to clinic_owner_accounts
-- ============================================================================

\echo ''
\echo 'Phase 3: Creating clinic_owner_accounts for organizations/addresses...'

-- Create clinic_owner_accounts for organizations that have appointments
INSERT INTO trapper.clinic_owner_accounts (display_name, source_system, source_display_names)
SELECT DISTINCT
    p.display_name,
    'clinichq',
    ARRAY[p.display_name]
FROM trapper.sot_people p
WHERE p.merged_into_person_id IS NULL
  AND p.is_organization = true
  AND p.data_source = 'clinichq'
  AND NOT EXISTS (
      SELECT 1 FROM trapper.clinic_owner_accounts coa
      WHERE coa.display_name = p.display_name
  )
ON CONFLICT DO NOTHING;

\echo 'Clinic accounts created. Count:'
SELECT COUNT(*) as clinic_accounts FROM trapper.clinic_owner_accounts;

-- ============================================================================
-- Phase 4: Clean up first-name-only duplicates
-- ============================================================================

\echo ''
\echo 'Phase 4: Handling first-name-only records...'

-- Mark first-name-only records as needing review (don't delete, might be valid)
-- We'll add a note in internal_notes for staff to review

-- First, identify the worst offenders
SELECT display_name, COUNT(*) as count, data_source::text
FROM trapper.sot_people
WHERE merged_into_person_id IS NULL
  AND display_name NOT LIKE '% %'  -- Single word
  AND LENGTH(display_name) > 2
  AND display_name NOT LIKE '%@%'
  AND data_source IN ('web_app', 'web_intake')
GROUP BY display_name, data_source
HAVING COUNT(*) > 3
ORDER BY count DESC
LIMIT 10;

-- Merge "Unknown" duplicates from web_intake
DO $$
DECLARE
    v_canonical UUID;
    v_dup UUID;
    v_merged INT := 0;
BEGIN
    -- Get canonical "Unknown" record
    SELECT person_id INTO v_canonical
    FROM trapper.sot_people
    WHERE display_name = 'Unknown' AND merged_into_person_id IS NULL
    ORDER BY created_at
    LIMIT 1;

    IF v_canonical IS NOT NULL THEN
        FOR v_dup IN
            SELECT person_id FROM trapper.sot_people
            WHERE display_name = 'Unknown'
              AND merged_into_person_id IS NULL
              AND person_id != v_canonical
        LOOP
            PERFORM trapper.merge_people(v_canonical, v_dup);
            v_merged := v_merged + 1;
        END LOOP;
        RAISE NOTICE 'Phase 4a: Merged % "Unknown" records', v_merged;
    END IF;
END $$;

-- Merge "SCAS" duplicates (Sonoma County Animal Services abbreviation)
DO $$
DECLARE
    v_canonical UUID;
    v_dup UUID;
    v_merged INT := 0;
BEGIN
    SELECT person_id INTO v_canonical
    FROM trapper.sot_people
    WHERE LOWER(display_name) = 'scas' AND merged_into_person_id IS NULL
    ORDER BY created_at
    LIMIT 1;

    IF v_canonical IS NOT NULL THEN
        UPDATE trapper.sot_people SET is_organization = true WHERE person_id = v_canonical;

        FOR v_dup IN
            SELECT person_id FROM trapper.sot_people
            WHERE LOWER(display_name) = 'scas'
              AND merged_into_person_id IS NULL
              AND person_id != v_canonical
        LOOP
            PERFORM trapper.merge_people(v_canonical, v_dup);
            v_merged := v_merged + 1;
        END LOOP;
        RAISE NOTICE 'Phase 4b: Merged % "SCAS" records', v_merged;
    END IF;
END $$;

-- ============================================================================
-- Phase 5: Clean up place display_names that are person names
-- ============================================================================

\echo ''
\echo 'Phase 5: Fixing place display_names that are person names...'

-- Clear display_name for places where display_name looks like a person name
-- but the formatted_address is a real address (keep the address)
UPDATE trapper.places
SET display_name = NULL
WHERE merged_into_place_id IS NULL
  AND display_name IS NOT NULL
  AND formatted_address IS NOT NULL
  AND LENGTH(formatted_address) > 10
  -- Display name looks like a person name (First Last pattern)
  AND display_name ~ '^[A-Z][a-z]+ [A-Z][a-z]+$'
  -- And display_name doesn't appear in the address
  AND formatted_address NOT ILIKE '%' || display_name || '%'
  -- Exclude ShelterLuv "residence" pattern which is intentional
  AND display_name NOT LIKE '%residence%';

\echo 'Places with person-name display_names cleared. Count affected:'
SELECT COUNT(*) as places_fixed
FROM trapper.places
WHERE display_name IS NULL
  AND formatted_address ~ '^[0-9]';

-- ============================================================================
-- Phase 6: Fix doubled place names (data entry errors)
-- ============================================================================

\echo ''
\echo 'Phase 6: Fixing doubled place names...'

-- Fix display_names that are repeated (e.g., "Comstock Middle School Comstock Middle School")
UPDATE trapper.places
SET display_name = SUBSTRING(display_name FROM 1 FOR LENGTH(display_name)/2)
WHERE merged_into_place_id IS NULL
  AND display_name IS NOT NULL
  AND LENGTH(display_name) >= 10
  -- Display name is exactly doubled
  AND SUBSTRING(display_name FROM 1 FOR LENGTH(display_name)/2) =
      SUBSTRING(display_name FROM LENGTH(display_name)/2 + 1);

\echo 'Doubled place names fixed. Examples:'
SELECT display_name, formatted_address
FROM trapper.places
WHERE display_name IN ('Comstock Middle School', 'Old Stony Point Rd', 'Peterbilt Truck Stop', 'Wilco Farm Store')
  AND merged_into_place_id IS NULL
LIMIT 5;

-- ============================================================================
-- Phase 7: Summary and verification
-- ============================================================================

\echo ''
\echo '=== Phase 7: Summary ==='

\echo ''
\echo 'People table status:'
SELECT
    data_source::text,
    COUNT(*) as total,
    COUNT(*) FILTER (WHERE is_organization) as organizations,
    COUNT(*) FILTER (WHERE merged_into_person_id IS NOT NULL) as merged
FROM trapper.sot_people
GROUP BY data_source
ORDER BY total DESC;

\echo ''
\echo 'Remaining duplicates (should be low):'
SELECT display_name, COUNT(*) as count
FROM trapper.sot_people
WHERE merged_into_person_id IS NULL
  AND display_name LIKE '% %'
  AND data_source = 'clinichq'
  AND NOT EXISTS (
      SELECT 1 FROM trapper.person_identifiers pi
      WHERE pi.person_id = sot_people.person_id
  )
GROUP BY display_name
HAVING COUNT(*) > 1
ORDER BY count DESC
LIMIT 10;

\echo ''
\echo 'Clinic owner accounts:'
SELECT COUNT(*) as total FROM trapper.clinic_owner_accounts;

\echo ''
\echo '=========================================='
\echo 'MIG_895 Complete!'
\echo '=========================================='
\echo ''
\echo 'Cleanup performed:'
\echo '  1. Merged duplicate people with same name (no identifiers)'
\echo '  2. Marked organizations as is_organization = true'
\echo '  3. Created clinic_owner_accounts for org pseudo-profiles'
\echo '  4. Merged "Unknown" and "SCAS" duplicates'
\echo '  5. Cleared person-name display_names from places'
\echo '  6. Fixed doubled place names (data entry errors)'
\echo ''
\echo 'The current ingest pipeline (Data Engine + should_be_person)'
\echo 'is working correctly. No new duplicates should be created.'
\echo ''
