-- MIG_2072: Migrate remaining V1 data to V2 (places, identifiers, relationships)
-- Date: 2026-02-14
--
-- Fixes schema mismatches from MIG_2071

\echo ''
\echo '=============================================='
\echo '  MIG_2072: Migrate Remaining V1 → V2'
\echo '=============================================='
\echo ''

-- ============================================================================
-- STEP 1: MIGRATE PLACES (fixed column names)
-- ============================================================================

\echo '1. Migrating sot.places from trapper.places...'

INSERT INTO sot.places (
    place_id,
    display_name,
    formatted_address,
    sot_address_id,
    location,
    place_kind,
    is_address_backed,
    has_cat_activity,
    place_origin,
    merged_into_place_id,
    last_activity_at,
    created_at,
    updated_at,
    migrated_at
)
SELECT
    p.place_id,
    p.display_name,
    p.formatted_address,
    p.sot_address_id,
    p.location,
    -- Map V1 place_kind enum to V2 place_kind text
    CASE p.place_kind::text
        WHEN 'residential_house' THEN 'single_family'
        WHEN 'apartment_unit' THEN 'apartment_unit'
        WHEN 'apartment_building' THEN 'apartment_building'
        WHEN 'mobile_home_space' THEN 'mobile_home'
        WHEN 'business' THEN 'business'
        WHEN 'clinic' THEN 'clinic'
        WHEN 'neighborhood' THEN 'outdoor_site'
        WHEN 'outdoor_site' THEN 'outdoor_site'
        ELSE 'unknown'
    END::text,
    COALESCE(p.is_address_backed, FALSE),
    COALESCE(p.has_cat_activity, FALSE),
    COALESCE(p.place_origin, 'legacy_import'),
    NULL, -- V1 doesn't have merged_into_place_id at this point
    p.last_activity_at,
    COALESCE(p.created_at, NOW()),
    COALESCE(p.updated_at, NOW()),
    NOW()
FROM trapper.places p
WHERE NOT EXISTS (
    SELECT 1 FROM sot.places v2 WHERE v2.place_id = p.place_id
)
ON CONFLICT (place_id) DO NOTHING;

DO $$
DECLARE v_count INT;
BEGIN
    SELECT COUNT(*) INTO v_count FROM sot.places;
    RAISE NOTICE 'sot.places now has % records', v_count;
END $$;

-- ============================================================================
-- STEP 2: MIGRATE CAT IDENTIFIERS (no confidence column in V2)
-- ============================================================================

\echo ''
\echo '2. Migrating sot.cat_identifiers...'

INSERT INTO sot.cat_identifiers (
    cat_id,
    id_type,
    id_value,
    source_system,
    created_at
)
SELECT
    ci.cat_id,
    -- Normalize id_type to match V2 constraint
    CASE ci.id_type
        WHEN 'microchip' THEN 'microchip'
        WHEN 'microchip_truncated' THEN 'microchip'
        WHEN 'microchip_avid' THEN 'microchip'
        WHEN 'microchip_10digit' THEN 'microchip'
        WHEN 'clinichq_animal_id' THEN 'clinichq_animal_id'
        WHEN 'shelterluv_id' THEN 'shelterluv_animal_id'
        WHEN 'atlas_id' THEN 'airtable_id'  -- Map atlas_id to airtable_id
        ELSE NULL  -- Skip unknown types
    END,
    ci.id_value,
    COALESCE(ci.source_system, 'clinichq'),
    COALESCE(ci.created_at, NOW())
FROM trapper.cat_identifiers ci
WHERE ci.id_type IN ('microchip', 'microchip_truncated', 'microchip_avid', 'microchip_10digit',
                     'clinichq_animal_id', 'shelterluv_id', 'atlas_id')
  AND EXISTS (SELECT 1 FROM sot.cats c WHERE c.cat_id = ci.cat_id)
  AND NOT EXISTS (
    SELECT 1 FROM sot.cat_identifiers v2
    WHERE v2.cat_id = ci.cat_id
      AND v2.id_type = CASE ci.id_type
        WHEN 'microchip' THEN 'microchip'
        WHEN 'microchip_truncated' THEN 'microchip'
        WHEN 'microchip_avid' THEN 'microchip'
        WHEN 'microchip_10digit' THEN 'microchip'
        WHEN 'clinichq_animal_id' THEN 'clinichq_animal_id'
        WHEN 'shelterluv_id' THEN 'shelterluv_animal_id'
        WHEN 'atlas_id' THEN 'airtable_id'
        ELSE ci.id_type
      END
      AND v2.id_value = ci.id_value
  )
ON CONFLICT (id_type, id_value) DO NOTHING;

-- Update microchip on sot.cats for quick lookup
UPDATE sot.cats c
SET microchip = ci.id_value
FROM sot.cat_identifiers ci
WHERE ci.cat_id = c.cat_id
  AND ci.id_type = 'microchip'
  AND c.microchip IS NULL;

-- Update clinichq_animal_id
UPDATE sot.cats c
SET clinichq_animal_id = ci.id_value
FROM sot.cat_identifiers ci
WHERE ci.cat_id = c.cat_id
  AND ci.id_type = 'clinichq_animal_id'
  AND c.clinichq_animal_id IS NULL;

-- Update shelterluv_animal_id
UPDATE sot.cats c
SET shelterluv_animal_id = ci.id_value
FROM sot.cat_identifiers ci
WHERE ci.cat_id = c.cat_id
  AND ci.id_type = 'shelterluv_animal_id'
  AND c.shelterluv_animal_id IS NULL;

DO $$
DECLARE v_count INT;
BEGIN
    SELECT COUNT(*) INTO v_count FROM sot.cat_identifiers;
    RAISE NOTICE 'sot.cat_identifiers now has % records', v_count;
END $$;

-- ============================================================================
-- STEP 3: MIGRATE PEOPLE (check actual V1 columns)
-- ============================================================================

\echo ''
\echo '3. Migrating remaining sot.people...'

-- Check what columns V1 sot_people has
INSERT INTO sot.people (
    person_id,
    display_name,
    first_name,
    last_name,
    is_organization,
    merged_into_person_id,
    source_system,
    created_at,
    updated_at,
    migrated_at
)
SELECT
    p.person_id,
    p.display_name,
    -- Parse first_name from display_name if not available
    COALESCE(
        SPLIT_PART(p.display_name, ' ', 1),
        p.display_name
    ),
    -- Parse last_name from display_name if not available
    CASE
        WHEN POSITION(' ' IN COALESCE(p.display_name, '')) > 0
        THEN SUBSTRING(p.display_name FROM POSITION(' ' IN p.display_name) + 1)
        ELSE ''
    END,
    COALESCE(p.is_organization, FALSE),
    p.merged_into_person_id,
    COALESCE(p.source_system, 'clinichq'),
    COALESCE(p.created_at, NOW()),
    COALESCE(p.updated_at, NOW()),
    NOW()
FROM trapper.sot_people p
WHERE NOT EXISTS (
    SELECT 1 FROM sot.people v2 WHERE v2.person_id = p.person_id
)
ON CONFLICT (person_id) DO NOTHING;

DO $$
DECLARE v_count INT;
BEGIN
    SELECT COUNT(*) INTO v_count FROM sot.people;
    RAISE NOTICE 'sot.people now has % records', v_count;
END $$;

-- ============================================================================
-- STEP 4: MIGRATE PERSON IDENTIFIERS
-- ============================================================================

\echo ''
\echo '4. Migrating sot.person_identifiers...'

INSERT INTO sot.person_identifiers (
    person_id,
    id_type,
    id_value,
    id_value_norm,
    confidence,
    source_system,
    created_at
)
SELECT
    pi.person_id,
    pi.id_type,
    pi.id_value,
    pi.id_value_norm,
    COALESCE(pi.confidence, 1.0),
    COALESCE(pi.source_system, 'clinichq'),
    COALESCE(pi.created_at, NOW())
FROM trapper.person_identifiers pi
WHERE EXISTS (SELECT 1 FROM sot.people p WHERE p.person_id = pi.person_id)
  AND NOT EXISTS (
    SELECT 1 FROM sot.person_identifiers v2
    WHERE v2.person_id = pi.person_id
      AND v2.id_type = pi.id_type
      AND v2.id_value_norm = pi.id_value_norm
  )
ON CONFLICT DO NOTHING;

DO $$
DECLARE v_count INT;
BEGIN
    SELECT COUNT(*) INTO v_count FROM sot.person_identifiers;
    RAISE NOTICE 'sot.person_identifiers now has % records', v_count;
END $$;

-- ============================================================================
-- STEP 5: MIGRATE CAT-PLACE RELATIONSHIPS
-- ============================================================================

\echo ''
\echo '5. Migrating sot.cat_place relationships...'

INSERT INTO sot.cat_place (
    cat_id,
    place_id,
    relationship_type,
    evidence_type,
    confidence,
    source_system,
    created_at,
    migrated_at
)
SELECT
    cpr.cat_id,
    cpr.place_id,
    -- Map V1 relationship_type to V2 values
    CASE cpr.relationship_type::text
        WHEN 'home' THEN 'home'
        WHEN 'residence' THEN 'residence'
        WHEN 'colony' THEN 'colony_member'
        WHEN 'colony_member' THEN 'colony_member'
        WHEN 'sighting' THEN 'sighting'
        WHEN 'trapped' THEN 'trapped_at'
        WHEN 'trapped_at' THEN 'trapped_at'
        WHEN 'treated' THEN 'treated_at'
        WHEN 'treated_at' THEN 'treated_at'
        WHEN 'found' THEN 'found_at'
        WHEN 'found_at' THEN 'found_at'
        ELSE 'residence'
    END::text,
    COALESCE(cpr.evidence_type::text, 'imported'),
    COALESCE(cpr.confidence, 0.8),
    COALESCE(cpr.source_system, 'clinichq'),
    COALESCE(cpr.created_at, NOW()),
    NOW()
FROM trapper.cat_place_relationships cpr
WHERE EXISTS (SELECT 1 FROM sot.cats c WHERE c.cat_id = cpr.cat_id)
  AND EXISTS (SELECT 1 FROM sot.places p WHERE p.place_id = cpr.place_id)
  AND NOT EXISTS (
    SELECT 1 FROM sot.cat_place v2
    WHERE v2.cat_id = cpr.cat_id AND v2.place_id = cpr.place_id
  )
ON CONFLICT (cat_id, place_id, relationship_type) DO NOTHING;

DO $$
DECLARE v_count INT;
BEGIN
    SELECT COUNT(*) INTO v_count FROM sot.cat_place;
    RAISE NOTICE 'sot.cat_place now has % records', v_count;
END $$;

-- ============================================================================
-- STEP 6: MIGRATE PERSON-PLACE RELATIONSHIPS
-- ============================================================================

\echo ''
\echo '6. Migrating sot.person_place relationships...'

INSERT INTO sot.person_place (
    person_id,
    place_id,
    relationship_type,
    evidence_type,
    confidence,
    is_primary,
    source_system,
    created_at,
    migrated_at
)
SELECT
    ppr.person_id,
    ppr.place_id,
    -- Map V1 relationship_type to V2 values
    CASE ppr.relationship_type::text
        WHEN 'resident' THEN 'resident'
        WHEN 'owner' THEN 'owner'
        WHEN 'manager' THEN 'manager'
        WHEN 'caretaker' THEN 'caretaker'
        WHEN 'works_at' THEN 'works_at'
        WHEN 'volunteer' THEN 'volunteers_at'
        WHEN 'volunteers_at' THEN 'volunteers_at'
        ELSE 'resident'
    END::text,
    COALESCE(ppr.evidence_type::text, 'imported'),
    COALESCE(ppr.confidence, 0.8),
    COALESCE(ppr.is_primary, FALSE),
    COALESCE(ppr.source_system, 'clinichq'),
    COALESCE(ppr.created_at, NOW()),
    NOW()
FROM trapper.person_place_relationships ppr
WHERE EXISTS (SELECT 1 FROM sot.people p WHERE p.person_id = ppr.person_id)
  AND EXISTS (SELECT 1 FROM sot.places p WHERE p.place_id = ppr.place_id)
  AND NOT EXISTS (
    SELECT 1 FROM sot.person_place v2
    WHERE v2.person_id = ppr.person_id AND v2.place_id = ppr.place_id
  )
ON CONFLICT (person_id, place_id, relationship_type) DO NOTHING;

DO $$
DECLARE v_count INT;
BEGIN
    SELECT COUNT(*) INTO v_count FROM sot.person_place;
    RAISE NOTICE 'sot.person_place now has % records', v_count;
END $$;

-- ============================================================================
-- STEP 7: MIGRATE PERSON-CAT RELATIONSHIPS
-- ============================================================================

\echo ''
\echo '7. Migrating sot.person_cat relationships...'

INSERT INTO sot.person_cat (
    person_id,
    cat_id,
    relationship_type,
    evidence_type,
    confidence,
    source_system,
    created_at,
    migrated_at
)
SELECT
    pcr.person_id,
    pcr.cat_id,
    -- Map V1 relationship_type to V2 values
    COALESCE(pcr.relationship_type::text, 'caretaker'),
    COALESCE(pcr.evidence_type::text, 'imported'),
    COALESCE(pcr.confidence, 0.8),
    COALESCE(pcr.source_system, 'clinichq'),
    COALESCE(pcr.created_at, NOW()),
    NOW()
FROM trapper.person_cat_relationships pcr
WHERE EXISTS (SELECT 1 FROM sot.people p WHERE p.person_id = pcr.person_id)
  AND EXISTS (SELECT 1 FROM sot.cats c WHERE c.cat_id = pcr.cat_id)
  AND NOT EXISTS (
    SELECT 1 FROM sot.person_cat v2
    WHERE v2.person_id = pcr.person_id AND v2.cat_id = pcr.cat_id
  )
ON CONFLICT DO NOTHING;

DO $$
DECLARE v_count INT;
BEGIN
    SELECT COUNT(*) INTO v_count FROM sot.person_cat;
    RAISE NOTICE 'sot.person_cat now has % records', v_count;
END $$;

-- ============================================================================
-- VERIFICATION
-- ============================================================================

\echo ''
\echo '=============================================='
\echo '  FINAL V2 TABLE COUNTS'
\echo '=============================================='

SELECT 'sot.places' as table_name, COUNT(*) as count FROM sot.places
UNION ALL SELECT 'sot.cats', COUNT(*) FROM sot.cats
UNION ALL SELECT 'sot.people', COUNT(*) FROM sot.people
UNION ALL SELECT 'sot.cat_identifiers', COUNT(*) FROM sot.cat_identifiers
UNION ALL SELECT 'sot.person_identifiers', COUNT(*) FROM sot.person_identifiers
UNION ALL SELECT 'ops.appointments', COUNT(*) FROM ops.appointments
UNION ALL SELECT 'sot.cat_place', COUNT(*) FROM sot.cat_place
UNION ALL SELECT 'sot.person_place', COUNT(*) FROM sot.person_place
UNION ALL SELECT 'sot.person_cat', COUNT(*) FROM sot.person_cat
ORDER BY table_name;

\echo ''
\echo '=============================================='
\echo '  MIG_2072 Complete!'
\echo '=============================================='
\echo ''
