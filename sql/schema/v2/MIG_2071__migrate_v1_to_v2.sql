-- MIG_2071: Migrate V1 data to V2 schema
-- Date: 2026-02-14
--
-- Migrates all core entities from trapper.* (V1) to sot.*/ops.* (V2)
-- Order matters due to foreign key constraints:
-- 1. Places (no dependencies)
-- 2. People (already partially migrated - 2,612 exist)
-- 3. Cats (no dependencies)
-- 4. Cat identifiers (depends on cats)
-- 5. Appointments (depends on cats, people, places)
-- 6. Relationship tables

\echo ''
\echo '=============================================='
\echo '  MIG_2071: V1 → V2 Data Migration'
\echo '=============================================='
\echo ''

-- ============================================================================
-- STEP 1: MIGRATE PLACES
-- ============================================================================

\echo '1. Migrating sot.places from trapper.places...'

INSERT INTO sot.places (
    place_id,
    display_name,
    formatted_address,
    location,
    place_kind,
    is_address_backed,
    has_cat_activity,
    data_source,
    merged_into_place_id,
    created_at,
    updated_at,
    migrated_at
)
SELECT
    p.place_id,
    p.display_name,
    p.formatted_address,
    p.location,
    -- Map V1 place_type to V2 place_kind
    CASE p.place_type
        WHEN 'residential' THEN 'single_family'
        WHEN 'apartment' THEN 'apartment_building'
        WHEN 'mobile_home' THEN 'mobile_home'
        WHEN 'business' THEN 'business'
        WHEN 'farm' THEN 'farm'
        WHEN 'outdoor' THEN 'outdoor_site'
        WHEN 'clinic' THEN 'clinic'
        WHEN 'shelter' THEN 'shelter'
        ELSE 'unknown'
    END::text,
    COALESCE(p.is_address_backed, FALSE),
    EXISTS(SELECT 1 FROM trapper.cat_place_relationships cpr WHERE cpr.place_id = p.place_id),
    COALESCE(p.data_source::text, 'legacy_import'),
    p.merged_into_place_id,
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
-- STEP 2: MIGRATE CATS
-- ============================================================================

\echo ''
\echo '2. Migrating sot.cats from trapper.sot_cats...'

INSERT INTO sot.cats (
    cat_id,
    name,
    sex,
    breed,
    primary_color,
    secondary_color,
    altered_status,
    ownership_type,
    is_deceased,
    deceased_at,
    data_source,
    merged_into_cat_id,
    source_system,
    created_at,
    updated_at,
    migrated_at
)
SELECT
    c.cat_id,
    c.display_name,
    -- Normalize sex to match V2 constraint
    CASE LOWER(TRIM(c.sex))
        WHEN 'male' THEN 'male'
        WHEN 'm' THEN 'male'
        WHEN 'female' THEN 'female'
        WHEN 'f' THEN 'female'
        ELSE 'unknown'
    END,
    c.breed,
    c.primary_color,
    c.secondary_color,
    -- Normalize altered_status to match V2 constraint
    CASE LOWER(TRIM(c.altered_status))
        WHEN 'spayed' THEN 'spayed'
        WHEN 'neutered' THEN 'neutered'
        WHEN 'intact' THEN 'intact'
        WHEN 'yes' THEN CASE LOWER(TRIM(c.sex)) WHEN 'female' THEN 'spayed' WHEN 'male' THEN 'neutered' ELSE 'unknown' END
        WHEN 'no' THEN 'intact'
        ELSE 'unknown'
    END,
    -- Normalize ownership_type to match V2 constraint
    CASE LOWER(TRIM(c.ownership_type))
        WHEN 'stray' THEN 'stray'
        WHEN 'owned' THEN 'owned'
        WHEN 'community' THEN 'community'
        WHEN 'community cat' THEN 'community'
        WHEN 'community cat (friendly)' THEN 'community'
        WHEN 'community cat (feral)' THEN 'feral'
        WHEN 'feral' THEN 'feral'
        WHEN 'barn' THEN 'barn'
        WHEN 'foster' THEN 'foster'
        ELSE 'unknown'
    END,
    COALESCE(c.is_deceased, FALSE),
    c.deceased_date::timestamptz,
    COALESCE(c.data_source::text, 'legacy_import'),
    c.merged_into_cat_id,
    'clinichq',
    COALESCE(c.created_at, NOW()),
    COALESCE(c.updated_at, NOW()),
    NOW()
FROM trapper.sot_cats c
WHERE NOT EXISTS (
    SELECT 1 FROM sot.cats v2 WHERE v2.cat_id = c.cat_id
)
ON CONFLICT (cat_id) DO NOTHING;

DO $$
DECLARE v_count INT;
BEGIN
    SELECT COUNT(*) INTO v_count FROM sot.cats;
    RAISE NOTICE 'sot.cats now has % records', v_count;
END $$;

-- ============================================================================
-- STEP 3: MIGRATE CAT IDENTIFIERS
-- ============================================================================

\echo ''
\echo '3. Migrating sot.cat_identifiers...'

-- First ensure all cats exist (for FK constraint)
INSERT INTO sot.cat_identifiers (
    cat_id,
    id_type,
    id_value,
    confidence,
    source_system,
    created_at
)
SELECT
    ci.cat_id,
    -- Normalize id_type
    CASE ci.id_type
        WHEN 'microchip' THEN 'microchip'
        WHEN 'microchip_truncated' THEN 'microchip'
        WHEN 'microchip_avid' THEN 'microchip'
        WHEN 'microchip_10digit' THEN 'microchip'
        WHEN 'clinichq_animal_id' THEN 'clinichq_animal_id'
        WHEN 'shelterluv_id' THEN 'shelterluv_animal_id'
        WHEN 'atlas_id' THEN 'atlas_id'
        ELSE ci.id_type
    END,
    ci.id_value,
    COALESCE(ci.confidence, 1.0),
    COALESCE(ci.source_system, 'clinichq'),
    COALESCE(ci.created_at, NOW())
FROM trapper.cat_identifiers ci
WHERE EXISTS (SELECT 1 FROM sot.cats c WHERE c.cat_id = ci.cat_id)
  AND NOT EXISTS (
    SELECT 1 FROM sot.cat_identifiers v2
    WHERE v2.cat_id = ci.cat_id AND v2.id_type = ci.id_type AND v2.id_value = ci.id_value
  )
ON CONFLICT DO NOTHING;

-- Also populate microchip directly on sot.cats for quick lookup
UPDATE sot.cats c
SET microchip = ci.id_value
FROM sot.cat_identifiers ci
WHERE ci.cat_id = c.cat_id
  AND ci.id_type = 'microchip'
  AND c.microchip IS NULL;

-- Populate clinichq_animal_id
UPDATE sot.cats c
SET clinichq_animal_id = ci.id_value
FROM sot.cat_identifiers ci
WHERE ci.cat_id = c.cat_id
  AND ci.id_type = 'clinichq_animal_id'
  AND c.clinichq_animal_id IS NULL;

-- Populate shelterluv_animal_id
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
-- STEP 4: MIGRATE PEOPLE (merge with existing)
-- ============================================================================

\echo ''
\echo '4. Migrating sot.people from trapper.sot_people...'

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
    p.first_name,
    p.last_name,
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
-- STEP 5: MIGRATE PERSON IDENTIFIERS
-- ============================================================================

\echo ''
\echo '5. Migrating sot.person_identifiers...'

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
    WHERE v2.person_id = pi.person_id AND v2.id_type = pi.id_type AND v2.id_value = pi.id_value
  )
ON CONFLICT DO NOTHING;

DO $$
DECLARE v_count INT;
BEGIN
    SELECT COUNT(*) INTO v_count FROM sot.person_identifiers;
    RAISE NOTICE 'sot.person_identifiers now has % records', v_count;
END $$;

-- ============================================================================
-- STEP 6: MIGRATE APPOINTMENTS
-- ============================================================================

\echo ''
\echo '6. Migrating ops.appointments from trapper.sot_appointments...'

INSERT INTO ops.appointments (
    appointment_id,
    cat_id,
    person_id,
    place_id,
    inferred_place_id,
    appointment_date,
    appointment_number,
    service_type,
    is_spay,
    is_neuter,
    is_alteration,
    vet_name,
    technician,
    temperature,
    medical_notes,
    is_lactating,
    is_pregnant,
    is_in_heat,
    owner_email,
    owner_phone,
    source_system,
    source_record_id,
    source_row_hash,
    created_at,
    updated_at,
    migrated_at
)
SELECT
    a.appointment_id,
    -- Only include cat_id if it exists in sot.cats
    CASE WHEN EXISTS (SELECT 1 FROM sot.cats c WHERE c.cat_id = a.cat_id) THEN a.cat_id ELSE NULL END,
    -- Only include person_id if it exists in sot.people
    CASE WHEN EXISTS (SELECT 1 FROM sot.people p WHERE p.person_id = a.person_id) THEN a.person_id ELSE NULL END,
    -- Only include place_id if it exists in sot.places
    CASE WHEN EXISTS (SELECT 1 FROM sot.places p WHERE p.place_id = a.place_id) THEN a.place_id ELSE NULL END,
    CASE WHEN EXISTS (SELECT 1 FROM sot.places p WHERE p.place_id = a.inferred_place_id) THEN a.inferred_place_id ELSE NULL END,
    a.appointment_date,
    a.appointment_number,
    a.service_type,
    COALESCE(a.is_spay, a.service_is_spay, FALSE),
    COALESCE(a.is_neuter, a.service_is_neuter, FALSE),
    COALESCE(a.is_spay, a.service_is_spay, FALSE) OR COALESCE(a.is_neuter, a.service_is_neuter, FALSE),
    a.vet_name,
    a.technician,
    a.temperature,
    a.medical_notes,
    a.is_lactating,
    a.is_pregnant,
    a.is_in_heat,
    a.owner_email,
    a.owner_phone,
    COALESCE(a.source_system, a.data_source, 'clinichq'),
    a.source_record_id,
    a.source_row_hash,
    COALESCE(a.created_at, NOW()),
    COALESCE(a.updated_at, NOW()),
    NOW()
FROM trapper.sot_appointments a
WHERE NOT EXISTS (
    SELECT 1 FROM ops.appointments v2 WHERE v2.appointment_id = a.appointment_id
)
ON CONFLICT (appointment_id) DO NOTHING;

DO $$
DECLARE v_count INT;
BEGIN
    SELECT COUNT(*) INTO v_count FROM ops.appointments;
    RAISE NOTICE 'ops.appointments now has % records', v_count;
END $$;

-- ============================================================================
-- STEP 7: MIGRATE RELATIONSHIP TABLES
-- ============================================================================

\echo ''
\echo '7. Migrating relationship tables...'

-- Cat-Place relationships
INSERT INTO sot.cat_place (
    cat_id,
    place_id,
    relationship_type,
    confidence,
    source_system,
    created_at
)
SELECT
    cpr.cat_id,
    cpr.place_id,
    COALESCE(cpr.relationship_type::text, 'residence'),
    COALESCE(cpr.confidence::text, 'medium'),
    COALESCE(cpr.source_system, 'clinichq'),
    COALESCE(cpr.created_at, NOW())
FROM trapper.cat_place_relationships cpr
WHERE EXISTS (SELECT 1 FROM sot.cats c WHERE c.cat_id = cpr.cat_id)
  AND EXISTS (SELECT 1 FROM sot.places p WHERE p.place_id = cpr.place_id)
  AND NOT EXISTS (
    SELECT 1 FROM sot.cat_place v2
    WHERE v2.cat_id = cpr.cat_id AND v2.place_id = cpr.place_id
  )
ON CONFLICT DO NOTHING;

DO $$
DECLARE v_count INT;
BEGIN
    SELECT COUNT(*) INTO v_count FROM sot.cat_place;
    RAISE NOTICE 'sot.cat_place now has % records', v_count;
END $$;

-- Person-Place relationships
INSERT INTO sot.person_place (
    person_id,
    place_id,
    relationship_type,
    confidence,
    source_system,
    created_at
)
SELECT
    ppr.person_id,
    ppr.place_id,
    COALESCE(ppr.relationship_type::text, 'resident'),
    COALESCE(ppr.confidence::text, 'medium'),
    COALESCE(ppr.source_system, 'clinichq'),
    COALESCE(ppr.created_at, NOW())
FROM trapper.person_place_relationships ppr
WHERE EXISTS (SELECT 1 FROM sot.people p WHERE p.person_id = ppr.person_id)
  AND EXISTS (SELECT 1 FROM sot.places p WHERE p.place_id = ppr.place_id)
  AND NOT EXISTS (
    SELECT 1 FROM sot.person_place v2
    WHERE v2.person_id = ppr.person_id AND v2.place_id = ppr.place_id
  )
ON CONFLICT DO NOTHING;

DO $$
DECLARE v_count INT;
BEGIN
    SELECT COUNT(*) INTO v_count FROM sot.person_place;
    RAISE NOTICE 'sot.person_place now has % records', v_count;
END $$;

-- Person-Cat relationships
INSERT INTO sot.person_cat (
    person_id,
    cat_id,
    relationship_type,
    confidence,
    source_system,
    created_at
)
SELECT
    pcr.person_id,
    pcr.cat_id,
    COALESCE(pcr.relationship_type::text, 'caretaker'),
    COALESCE(pcr.confidence::text, 'medium'),
    COALESCE(pcr.source_system, 'clinichq'),
    COALESCE(pcr.created_at, NOW())
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
\echo '  VERIFICATION - V2 Table Counts'
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
\echo 'Recent appointments by date:'
SELECT appointment_date, COUNT(*) as count
FROM ops.appointments
GROUP BY appointment_date
ORDER BY appointment_date DESC
LIMIT 10;

\echo ''
\echo '=============================================='
\echo '  MIG_2071 Complete!'
\echo '=============================================='
\echo ''
