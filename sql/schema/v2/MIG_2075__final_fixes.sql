-- MIG_2075: Final constraint-compliant migrations
-- Date: 2026-02-14

\echo ''
\echo '=============================================='
\echo '  MIG_2075: Final Constraint-Compliant Migrations'
\echo '=============================================='
\echo ''

-- ============================================================================
-- STEP 1: PERSON IDENTIFIERS (only email, phone, external_id)
-- ============================================================================

\echo '1. Migrating sot.person_identifiers (email/phone only)...'

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
    -- Map V1 id_type to V2 allowed values
    CASE pi.id_type::text
        WHEN 'email' THEN 'email'
        WHEN 'phone' THEN 'phone'
        WHEN 'phone_cell' THEN 'phone'
        WHEN 'phone_home' THEN 'phone'
        WHEN 'phone_work' THEN 'phone'
        ELSE 'external_id'  -- Map atlas_id, etc. to external_id
    END,
    COALESCE(pi.id_value_raw, pi.id_value_norm),
    pi.id_value_norm,
    COALESCE(pi.confidence, 1.0),
    COALESCE(pi.source_system, 'clinichq'),
    COALESCE(pi.created_at, NOW())
FROM trapper.person_identifiers pi
WHERE EXISTS (SELECT 1 FROM sot.people p WHERE p.person_id = pi.person_id)
  AND pi.id_type::text IN ('email', 'phone', 'phone_cell', 'phone_home', 'phone_work')  -- Only email/phone
  AND NOT EXISTS (
    SELECT 1 FROM sot.person_identifiers v2
    WHERE v2.person_id = pi.person_id
      AND v2.id_type = CASE pi.id_type::text
          WHEN 'email' THEN 'email'
          WHEN 'phone' THEN 'phone'
          WHEN 'phone_cell' THEN 'phone'
          WHEN 'phone_home' THEN 'phone'
          WHEN 'phone_work' THEN 'phone'
          ELSE 'external_id'
      END
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
-- STEP 2: PERSON-CAT (map to allowed relationship types)
-- ============================================================================

\echo ''
\echo '2. Migrating sot.person_cat...'

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
    -- Map to V2 allowed values: owner, adopter, foster, caretaker, colony_caretaker, rescuer, finder, trapper
    CASE pcr.relationship_type
        WHEN 'owner' THEN 'owner'
        WHEN 'adopter' THEN 'adopter'
        WHEN 'foster' THEN 'foster'
        WHEN 'caretaker' THEN 'caretaker'
        WHEN 'colony_caretaker' THEN 'colony_caretaker'
        WHEN 'rescuer' THEN 'rescuer'
        WHEN 'finder' THEN 'finder'
        WHEN 'trapper' THEN 'trapper'
        WHEN 'brought_by' THEN 'trapper'  -- Map brought_by to trapper
        WHEN 'trapped_by' THEN 'trapper'
        WHEN 'found_by' THEN 'finder'
        WHEN 'rescued_by' THEN 'rescuer'
        ELSE 'caretaker'  -- Default unmapped types to caretaker
    END,
    'imported',
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
\echo '=============================================='
\echo '  MIG_2075 Complete!'
\echo '=============================================='
\echo ''
