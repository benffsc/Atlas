-- MIG_2444: Fix ShelterLuv Place and Cat Linking
--
-- Problem: ShelterLuv processing creates people but:
-- 1. Does NOT create places from addresses
-- 2. Does NOT link people to places
-- 3. Does NOT link cats to their associated persons
--
-- This leaves 2,540 people without place links and 3,875 cats without person links.
--
-- Solution:
-- 1. Create places from ShelterLuv person addresses
-- 2. Link ShelterLuv people to their places
-- 3. Link ShelterLuv cats to their associated persons
--
-- Created: 2026-02-21

\echo ''
\echo '=============================================='
\echo '  MIG_2444: Fix ShelterLuv Place and Cat Linking'
\echo '=============================================='
\echo ''

-- ============================================================================
-- 1. CREATE PLACES FROM SHELTERLUV PERSON ADDRESSES
-- ============================================================================

\echo '1. Creating places from ShelterLuv addresses...'

WITH shelterluv_addresses AS (
    SELECT DISTINCT ON (address)
        sr.id as staged_id,
        sr.resulting_entity_id as person_id,
        CONCAT_WS(', ',
            NULLIF(TRIM(sr.payload->>'Street'), ''),
            NULLIF(TRIM(sr.payload->>'City'), ''),
            NULLIF(TRIM(sr.payload->>'State'), ''),
            NULLIF(TRIM(sr.payload->>'Zip'), '')
        ) as address
    FROM ops.staged_records sr
    WHERE sr.source_system = 'shelterluv'
      AND sr.source_table = 'people'
      AND sr.resulting_entity_id IS NOT NULL
      AND sr.payload->>'Street' IS NOT NULL
      AND TRIM(sr.payload->>'Street') != ''
      AND LENGTH(TRIM(sr.payload->>'Street')) > 5
    ORDER BY address, sr.created_at DESC
),
created_places AS (
    SELECT
        sa.*,
        sot.find_or_create_place_deduped(
            sa.address,
            NULL,  -- display_name
            NULL,  -- lat
            NULL,  -- lng
            'shelterluv'
        ) as place_id
    FROM shelterluv_addresses sa
    WHERE sa.address IS NOT NULL
      AND LENGTH(sa.address) > 10
)
SELECT COUNT(*) as places_created FROM created_places WHERE place_id IS NOT NULL;

-- ============================================================================
-- 2. LINK SHELTERLUV PEOPLE TO THEIR PLACES
-- ============================================================================

\echo ''
\echo '2. Linking ShelterLuv people to places...'

INSERT INTO sot.person_place (person_id, place_id, relationship_type, confidence, source_system, source_table)
SELECT DISTINCT
    sr.resulting_entity_id as person_id,
    p.place_id,
    'resident',
    0.8,
    'shelterluv',
    'people'
FROM ops.staged_records sr
-- Validate person exists (some resulting_entity_ids point to merged/deleted FFSC staff)
JOIN sot.people ppl ON ppl.person_id = sr.resulting_entity_id
    AND ppl.merged_into_person_id IS NULL
JOIN sot.places p ON p.normalized_address = sot.normalize_address(
    CONCAT_WS(', ',
        NULLIF(TRIM(sr.payload->>'Street'), ''),
        NULLIF(TRIM(sr.payload->>'City'), ''),
        NULLIF(TRIM(sr.payload->>'State'), ''),
        NULLIF(TRIM(sr.payload->>'Zip'), '')
    )
)
WHERE sr.source_system = 'shelterluv'
  AND sr.source_table = 'people'
  AND sr.resulting_entity_id IS NOT NULL
  AND sr.payload->>'Street' IS NOT NULL
  AND TRIM(sr.payload->>'Street') != ''
  AND p.merged_into_place_id IS NULL
  AND NOT EXISTS (
      SELECT 1 FROM sot.person_place pp
      WHERE pp.person_id = sr.resulting_entity_id AND pp.place_id = p.place_id
  )
ON CONFLICT DO NOTHING;

SELECT COUNT(*) as person_place_links_created
FROM sot.person_place
WHERE source_system = 'shelterluv';

-- ============================================================================
-- 3. LINK SHELTERLUV CATS TO THEIR ASSOCIATED PERSONS
-- ============================================================================

\echo ''
\echo '3. Linking ShelterLuv cats to their associated persons...'

-- First, let's see what identifier we can use for ShelterLuv cats
\echo '   Checking cat identifier column...'
SELECT column_name
FROM information_schema.columns
WHERE table_schema = 'sot' AND table_name = 'cats'
AND column_name LIKE '%shelterluv%';

-- Link cats to people using the AssociatedPerson data
-- Match by shelterluv_animal_id = Internal-ID, then by first+last name to find person
-- Note: ShelterLuv field names are FirstName/LastName (capital N)
INSERT INTO sot.person_cat (cat_id, person_id, relationship_type, confidence, source_system, source_table)
SELECT DISTINCT
    c.cat_id,
    p.person_id,
    CASE
        WHEN sr.payload->'AssociatedPerson'->>'RelationshipType' ILIKE '%foster%' THEN 'foster'
        WHEN sr.payload->'AssociatedPerson'->>'RelationshipType' ILIKE '%adopt%' THEN 'adopter'
        ELSE 'caretaker'
    END as relationship_type,
    0.8,
    'shelterluv',
    'animals'
FROM ops.staged_records sr
-- Match cats by shelterluv_animal_id (NOT source_record_id which may be empty)
JOIN sot.cats c ON c.shelterluv_animal_id = sr.payload->>'Internal-ID'
    AND c.merged_into_cat_id IS NULL
-- Match people by name (case-insensitive, trimmed)
JOIN sot.people p ON p.merged_into_person_id IS NULL
    AND LOWER(TRIM(p.first_name)) = LOWER(TRIM(sr.payload->'AssociatedPerson'->>'FirstName'))
    AND LOWER(TRIM(p.last_name)) = LOWER(TRIM(sr.payload->'AssociatedPerson'->>'LastName'))
WHERE sr.source_system = 'shelterluv'
  AND sr.source_table = 'animals'
  AND sr.payload->'AssociatedPerson' IS NOT NULL
  AND sr.payload->'AssociatedPerson'->>'FirstName' IS NOT NULL
  AND TRIM(sr.payload->'AssociatedPerson'->>'FirstName') != ''
  AND sr.payload->'AssociatedPerson'->>'LastName' IS NOT NULL
  AND TRIM(sr.payload->'AssociatedPerson'->>'LastName') != ''
  AND NOT EXISTS (
      SELECT 1 FROM sot.person_cat pc
      WHERE pc.cat_id = c.cat_id AND pc.person_id = p.person_id
  )
ON CONFLICT DO NOTHING;

-- ============================================================================
-- 4. PROPAGATE CAT-PLACE LINKS VIA PERSON CHAIN
-- ============================================================================

\echo ''
\echo '4. Running entity linking to propagate cat-place links...'

SELECT * FROM sot.run_all_entity_linking();

-- ============================================================================
-- VERIFICATION
-- ============================================================================

\echo ''
\echo '=============================================='
\echo '  VERIFICATION'
\echo '=============================================='

\echo ''
\echo 'ShelterLuv people with place links:'
SELECT
    COUNT(*) as total_sl_people,
    COUNT(*) FILTER (WHERE EXISTS (
        SELECT 1 FROM sot.person_place pp WHERE pp.person_id = p.person_id
    )) as has_place_link
FROM sot.people p
WHERE p.source_system = 'shelterluv'
  AND p.merged_into_person_id IS NULL;

\echo ''
\echo 'ShelterLuv cats with person/place links:'
SELECT
    COUNT(*) as total_sl_cats,
    COUNT(*) FILTER (WHERE EXISTS (
        SELECT 1 FROM sot.person_cat pc WHERE pc.cat_id = c.cat_id
    )) as has_person_link,
    COUNT(*) FILTER (WHERE EXISTS (
        SELECT 1 FROM sot.cat_place cp WHERE cp.cat_id = c.cat_id
    )) as has_place_link
FROM sot.cats c
WHERE c.source_system = 'shelterluv'
  AND c.merged_into_cat_id IS NULL;

\echo ''
\echo '=============================================='
\echo '  MIG_2444 Complete!'
\echo '=============================================='
