-- MIG_2074: Final relationship migrations
-- Date: 2026-02-14

\echo ''
\echo '=============================================='
\echo '  MIG_2074: Final Relationship Migrations'
\echo '=============================================='
\echo ''

-- ============================================================================
-- STEP 1: MIGRATE PERSON IDENTIFIERS (use id_value_raw)
-- ============================================================================

\echo '1. Migrating sot.person_identifiers...'

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
    pi.id_type::text,
    COALESCE(pi.id_value_raw, pi.id_value_norm),  -- V1 has id_value_raw
    pi.id_value_norm,
    COALESCE(pi.confidence, 1.0),
    COALESCE(pi.source_system, 'clinichq'),
    COALESCE(pi.created_at, NOW())
FROM trapper.person_identifiers pi
WHERE EXISTS (SELECT 1 FROM sot.people p WHERE p.person_id = pi.person_id)
  AND NOT EXISTS (
    SELECT 1 FROM sot.person_identifiers v2
    WHERE v2.person_id = pi.person_id
      AND v2.id_type = pi.id_type::text
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
-- STEP 2: MIGRATE CAT-PLACE (V1 has relationship_type, confidence is text)
-- ============================================================================

\echo ''
\echo '2. Migrating sot.cat_place...'

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
    -- Map relationship_type to V2 constraint values
    CASE cpr.relationship_type
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
    -- Convert text confidence to numeric
    CASE cpr.confidence
        WHEN 'high' THEN 0.9
        WHEN 'medium' THEN 0.7
        WHEN 'low' THEN 0.5
        ELSE 0.8
    END::numeric(3,2),
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
-- STEP 3: MIGRATE PERSON-CAT (V1 has relationship_type, confidence is text)
-- ============================================================================

\echo ''
\echo '3. Migrating sot.person_cat...'

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
    COALESCE(pcr.relationship_type, 'caretaker'),
    'imported',
    -- Convert text confidence to numeric
    CASE pcr.confidence
        WHEN 'high' THEN 0.9
        WHEN 'medium' THEN 0.7
        WHEN 'low' THEN 0.5
        ELSE 0.8
    END::numeric(3,2),
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
\echo 'Recent appointments by date:'
SELECT appointment_date, COUNT(*) as count
FROM ops.appointments
GROUP BY appointment_date
ORDER BY appointment_date DESC
LIMIT 10;

\echo ''
\echo '=============================================='
\echo '  MIG_2074 Complete!'
\echo '=============================================='
\echo ''
