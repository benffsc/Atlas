-- MIG_2073: Final V1 → V2 migration fixes
-- Date: 2026-02-14
--
-- Fixes remaining schema mismatches

\echo ''
\echo '=============================================='
\echo '  MIG_2073: Final V1 → V2 Fixes'
\echo '=============================================='
\echo ''

-- ============================================================================
-- STEP 1: MIGRATE PLACES (set sot_address_id = NULL to avoid FK issues)
-- ============================================================================

\echo '1. Migrating sot.places (without address FK)...'

INSERT INTO sot.places (
    place_id,
    display_name,
    formatted_address,
    sot_address_id,  -- Set to NULL to avoid FK issue
    location,
    place_kind,
    is_address_backed,
    has_cat_activity,
    place_origin,
    last_activity_at,
    created_at,
    updated_at,
    migrated_at
)
SELECT
    p.place_id,
    p.display_name,
    p.formatted_address,
    NULL,  -- Skip sot_address_id for now
    p.location,
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
-- STEP 2: MIGRATE PEOPLE (use data_source, not source_system)
-- ============================================================================

\echo ''
\echo '2. Migrating sot.people...'

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
    COALESCE(
        SPLIT_PART(p.display_name, ' ', 1),
        p.display_name
    ),
    CASE
        WHEN POSITION(' ' IN COALESCE(p.display_name, '')) > 0
        THEN SUBSTRING(p.display_name FROM POSITION(' ' IN p.display_name) + 1)
        ELSE ''
    END,
    COALESCE(p.entity_type = 'organization', p.account_type = 'organization', FALSE),
    p.merged_into_person_id,
    COALESCE(p.data_source::text, 'clinichq'),  -- V1 has data_source
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
-- STEP 3: MIGRATE PERSON IDENTIFIERS (use id_value_raw/id_value_norm)
-- ============================================================================

\echo ''
\echo '3. Migrating sot.person_identifiers...'

INSERT INTO sot.person_identifiers (
    person_id,
    id_type,
    id_value_raw,
    id_value_norm,
    confidence,
    source_system,
    created_at
)
SELECT
    pi.person_id,
    pi.id_type,
    pi.id_value,        -- V1 id_value → V2 id_value_raw
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
ON CONFLICT (id_type, id_value_norm) DO NOTHING;

DO $$
DECLARE v_count INT;
BEGIN
    SELECT COUNT(*) INTO v_count FROM sot.person_identifiers;
    RAISE NOTICE 'sot.person_identifiers now has % records', v_count;
END $$;

-- ============================================================================
-- STEP 4: MIGRATE PERSON-PLACE (use role, not relationship_type)
-- ============================================================================

\echo ''
\echo '4. Migrating sot.person_place...'

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
    -- Map V1 role enum to V2 relationship_type
    CASE ppr.role::text
        WHEN 'resident' THEN 'resident'
        WHEN 'owner' THEN 'owner'
        WHEN 'manager' THEN 'manager'
        WHEN 'caretaker' THEN 'caretaker'
        WHEN 'works_at' THEN 'works_at'
        WHEN 'volunteer' THEN 'volunteers_at'
        WHEN 'volunteers_at' THEN 'volunteers_at'
        ELSE 'resident'
    END::text,
    'imported',
    COALESCE(ppr.confidence, 0.8),
    FALSE,
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
-- STEP 5: MIGRATE CAT-PLACE (use role, not relationship_type)
-- ============================================================================

\echo ''
\echo '5. Migrating sot.cat_place...'

-- Check V1 cat_place_relationships structure
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
    -- Map V1 role to V2 relationship_type
    CASE cpr.role::text
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
    'imported',
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
-- STEP 6: MIGRATE PERSON-CAT (use role, not relationship_type)
-- ============================================================================

\echo ''
\echo '6. Migrating sot.person_cat...'

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
    COALESCE(pcr.role::text, 'caretaker'),
    'imported',
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
-- STEP 7: UPDATE APPOINTMENT FKs now that entities exist
-- ============================================================================

\echo ''
\echo '7. Re-linking appointments to V2 entities...'

-- Link appointments to cats
UPDATE ops.appointments a
SET cat_id = c.cat_id
FROM trapper.sot_appointments v1
JOIN sot.cats c ON c.cat_id = v1.cat_id
WHERE a.appointment_id = v1.appointment_id
  AND a.cat_id IS NULL
  AND v1.cat_id IS NOT NULL;

-- Link appointments to people
UPDATE ops.appointments a
SET person_id = p.person_id
FROM trapper.sot_appointments v1
JOIN sot.people p ON p.person_id = v1.person_id
WHERE a.appointment_id = v1.appointment_id
  AND a.person_id IS NULL
  AND v1.person_id IS NOT NULL;

-- Link appointments to places
UPDATE ops.appointments a
SET place_id = pl.place_id
FROM trapper.sot_appointments v1
JOIN sot.places pl ON pl.place_id = v1.place_id
WHERE a.appointment_id = v1.appointment_id
  AND a.place_id IS NULL
  AND v1.place_id IS NOT NULL;

-- Link appointments to inferred places
UPDATE ops.appointments a
SET inferred_place_id = pl.place_id
FROM trapper.sot_appointments v1
JOIN sot.places pl ON pl.place_id = v1.inferred_place_id
WHERE a.appointment_id = v1.appointment_id
  AND a.inferred_place_id IS NULL
  AND v1.inferred_place_id IS NOT NULL;

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
\echo 'Appointments with linked entities:'
SELECT
    COUNT(*) as total,
    COUNT(cat_id) as with_cat,
    COUNT(person_id) as with_person,
    COUNT(place_id) as with_place
FROM ops.appointments;

\echo ''
\echo '=============================================='
\echo '  MIG_2073 Complete!'
\echo '=============================================='
\echo ''
