-- =====================================================
-- MIG_545: Fix Old Appointment-Cat Links
-- =====================================================
-- Problem: Many old appointments (2020-2021) have:
--   1. Microchip in Animal Name field, not Microchip Number
--   2. Cats that don't exist yet in sot_cats
--   3. No person-cat relationships
--
-- Solution:
--   1. Create cats for microchips that don't exist yet
--   2. Extract microchips from Animal Name field
--   3. Link appointments to cats
--   4. Create person-cat relationships with context
-- =====================================================

\echo '=== MIG_545: Fix Old Appointment-Cat Links ==='
\echo ''

-- ============================================================
-- 1. Baseline: Count unlinked appointments
-- ============================================================

\echo 'Baseline - Appointments status:'
SELECT
    COUNT(*) as total_appointments,
    COUNT(*) FILTER (WHERE cat_id IS NULL) as without_cat,
    COUNT(*) FILTER (WHERE cat_id IS NOT NULL) as with_cat,
    COUNT(*) FILTER (WHERE person_id IS NULL) as without_person,
    COUNT(*) FILTER (WHERE place_id IS NULL) as without_place
FROM trapper.sot_appointments;

-- ============================================================
-- 2. Find all microchips in staged appointment_info
-- ============================================================

\echo ''
\echo 'Step 1: Finding all microchips in appointment data...'

CREATE TEMP TABLE all_appointment_microchips AS
SELECT DISTINCT
    sr.row_hash,
    sr.payload->>'Number' as appointment_number,
    sr.payload->>'Date' as appointment_date,
    COALESCE(
        NULLIF(sr.payload->>'Microchip Number', ''),
        (regexp_match(sr.payload->>'Animal Name', '([0-9]{15})'))[1]
    ) as microchip
FROM trapper.staged_records sr
WHERE sr.source_system = 'clinichq'
  AND sr.source_table = 'appointment_info'
  AND (
    LENGTH(COALESCE(sr.payload->>'Microchip Number', '')) > 0
    OR sr.payload->>'Animal Name' ~ '[0-9]{15}'
  );

SELECT COUNT(*) as appointments_with_microchips FROM all_appointment_microchips;

-- ============================================================
-- 3. Find microchips that don't have cats yet
-- ============================================================

\echo ''
\echo 'Step 2: Finding microchips without existing cats...'

CREATE TEMP TABLE missing_cats AS
SELECT DISTINCT am.microchip
FROM all_appointment_microchips am
WHERE am.microchip IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM trapper.cat_identifiers ci
    WHERE ci.id_type = 'microchip' AND ci.id_value = am.microchip
  );

SELECT COUNT(*) as microchips_without_cats FROM missing_cats;

-- ============================================================
-- 4. Create cats for missing microchips (using cat_info if available)
-- ============================================================

\echo ''
\echo 'Step 3: Creating cats for missing microchips...'

-- Get cat info from cat_info staged records
CREATE TEMP TABLE new_cat_data AS
SELECT DISTINCT ON (mc.microchip)
    mc.microchip,
    sr.payload->>'Animal Name' as name,
    sr.payload->>'Sex' as sex,
    sr.payload->>'Breed' as breed,
    sr.payload->>'Primary Color' as primary_color,
    sr.payload->>'Secondary Color' as secondary_color,
    sr.payload->>'Number' as clinichq_animal_id
FROM missing_cats mc
LEFT JOIN trapper.staged_records sr ON sr.source_system = 'clinichq'
    AND sr.source_table = 'cat_info'
    AND sr.payload->>'Microchip Number' = mc.microchip
ORDER BY mc.microchip, sr.created_at DESC;

-- Create cats using find_or_create_cat_by_microchip
DO $$
DECLARE
    r RECORD;
    v_cat_id UUID;
BEGIN
    FOR r IN (SELECT * FROM new_cat_data WHERE microchip IS NOT NULL)
    LOOP
        SELECT trapper.find_or_create_cat_by_microchip(
            p_microchip := r.microchip,
            p_name := COALESCE(r.name, 'Unknown'),
            p_sex := CASE
                WHEN r.sex ILIKE '%female%' THEN 'female'
                WHEN r.sex ILIKE '%male%' THEN 'male'
                ELSE 'unknown'
            END,
            p_breed := r.breed,
            p_color := CONCAT_WS(', ', r.primary_color, NULLIF(r.secondary_color, '')),
            p_source_system := 'clinichq',
            p_source_record_id := r.clinichq_animal_id
        ) INTO v_cat_id;

        -- Add clinichq_animal_id identifier if available
        IF r.clinichq_animal_id IS NOT NULL AND r.clinichq_animal_id != '' THEN
            INSERT INTO trapper.cat_identifiers (cat_id, id_type, id_value, source_system, source_table)
            VALUES (v_cat_id, 'clinichq_animal_id', r.clinichq_animal_id, 'clinichq', 'cat_info')
            ON CONFLICT (id_type, id_value) DO NOTHING;
        END IF;
    END LOOP;
END $$;

\echo 'Cats created:'
SELECT COUNT(*) as total_cats FROM trapper.sot_cats;
SELECT COUNT(*) as microchip_identifiers FROM trapper.cat_identifiers WHERE id_type = 'microchip';

DROP TABLE new_cat_data;
DROP TABLE missing_cats;

-- ============================================================
-- 5. Link appointments to cats via microchip
-- ============================================================

\echo ''
\echo 'Step 4: Linking appointments to cats via microchip...'

-- Link via Microchip Number field
UPDATE trapper.sot_appointments a
SET cat_id = ci.cat_id,
    updated_at = NOW()
FROM all_appointment_microchips am
JOIN trapper.cat_identifiers ci ON ci.id_type = 'microchip' AND ci.id_value = am.microchip
WHERE a.source_row_hash = am.row_hash
  AND a.cat_id IS NULL
  AND am.microchip IS NOT NULL;

\echo 'After microchip linking:'
SELECT
    COUNT(*) as total,
    COUNT(*) FILTER (WHERE cat_id IS NOT NULL) as linked,
    COUNT(*) FILTER (WHERE cat_id IS NULL) as unlinked
FROM trapper.sot_appointments;

DROP TABLE all_appointment_microchips;

-- ============================================================
-- 6. Fallback: Link via clinichq_animal_id
-- ============================================================

\echo ''
\echo 'Step 5: Fallback linking via clinichq_animal_id...'

UPDATE trapper.sot_appointments a
SET cat_id = ci.cat_id,
    updated_at = NOW()
FROM trapper.cat_identifiers ci
WHERE ci.id_type = 'clinichq_animal_id'
  AND ci.id_value = a.appointment_number
  AND a.cat_id IS NULL
  AND a.appointment_number IS NOT NULL;

\echo 'After fallback linking:'
SELECT
    COUNT(*) as total,
    COUNT(*) FILTER (WHERE cat_id IS NOT NULL) as linked,
    COUNT(*) FILTER (WHERE cat_id IS NULL) as unlinked
FROM trapper.sot_appointments;

-- ============================================================
-- 7. Create person-cat relationships for all linked appointments
-- ============================================================

\echo ''
\echo 'Step 6: Creating person-cat relationships...'

-- Use the new function from MIG_544 if it exists, otherwise direct insert
DO $$
DECLARE
    r RECORD;
    v_count INT := 0;
BEGIN
    -- Check if function exists
    IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'link_appointment_to_person_cat' AND pronamespace = 'trapper'::regnamespace) THEN
        -- Use the function
        FOR r IN (
            SELECT appointment_id
            FROM trapper.sot_appointments
            WHERE cat_id IS NOT NULL AND person_id IS NOT NULL
        )
        LOOP
            PERFORM trapper.link_appointment_to_person_cat(r.appointment_id);
            v_count := v_count + 1;
        END LOOP;
        RAISE NOTICE 'Created relationships for % appointments using link_appointment_to_person_cat()', v_count;
    ELSE
        -- Fallback: direct insert (basic owner relationships)
        INSERT INTO trapper.person_cat_relationships (
            person_cat_id,
            person_id,
            cat_id,
            relationship_type,
            confidence,
            source_system,
            source_table,
            created_at
        )
        SELECT DISTINCT ON (a.person_id, a.cat_id)
            gen_random_uuid(),
            a.person_id,
            a.cat_id,
            'owner',
            'high',
            'clinichq',
            'sot_appointments',
            NOW()
        FROM trapper.sot_appointments a
        WHERE a.cat_id IS NOT NULL
          AND a.person_id IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM trapper.person_cat_relationships pcr
            WHERE pcr.person_id = a.person_id AND pcr.cat_id = a.cat_id
          )
        ORDER BY a.person_id, a.cat_id, a.appointment_date ASC
        ON CONFLICT DO NOTHING;

        GET DIAGNOSTICS v_count = ROW_COUNT;
        RAISE NOTICE 'Created % basic owner relationships via fallback', v_count;
    END IF;
END $$;

\echo 'Person-cat relationships:'
SELECT
    COUNT(*) as total_relationships,
    COUNT(*) FILTER (WHERE relationship_type = 'owner') as owners,
    COUNT(*) FILTER (WHERE relationship_type = 'brought_in_by') as brought_in_by,
    COUNT(*) FILTER (WHERE relationship_type = 'adopter') as adopters,
    COUNT(*) FILTER (WHERE relationship_type = 'fostering') as fostering
FROM trapper.person_cat_relationships;

-- ============================================================
-- 8. Update cat_place_relationships
-- ============================================================

\echo ''
\echo 'Step 7: Updating cat_place_relationships...'

INSERT INTO trapper.cat_place_relationships (
    cat_id,
    place_id,
    relationship_type,
    source_system,
    source_table
)
SELECT DISTINCT
    a.cat_id,
    a.place_id,
    'appointment_site',
    'clinichq',
    'sot_appointments'
FROM trapper.sot_appointments a
WHERE a.cat_id IS NOT NULL
  AND a.place_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM trapper.cat_place_relationships cpr
    WHERE cpr.cat_id = a.cat_id AND cpr.place_id = a.place_id
  )
ON CONFLICT DO NOTHING;

\echo 'Cat-place relationships:'
SELECT COUNT(*) as total FROM trapper.cat_place_relationships;

-- ============================================================
-- 9. Verification - Check Heather's cats specifically
-- ============================================================

\echo ''
\echo '====== VERIFICATION - Heather Singkeo Case ======'

\echo ''
\echo 'Heather Singkeo person records:'
SELECT person_id, display_name, email, phone
FROM trapper.sot_people
WHERE display_name ILIKE '%heather%singkeo%' OR email ILIKE '%singkeo%';

\echo ''
\echo 'Cats linked to Heather via person_cat_relationships:'
SELECT
    c.display_name as cat_name,
    ci.id_value as microchip,
    pcr.relationship_type,
    pcr.effective_date,
    pcr.context_notes
FROM trapper.person_cat_relationships pcr
JOIN trapper.sot_cats c ON c.cat_id = pcr.cat_id
LEFT JOIN trapper.cat_identifiers ci ON ci.cat_id = c.cat_id AND ci.id_type = 'microchip'
JOIN trapper.sot_people p ON p.person_id = pcr.person_id
WHERE p.email ILIKE '%singkeo%'
ORDER BY pcr.created_at;

\echo ''
\echo 'Heather appointments with cat links:'
SELECT
    a.appointment_number,
    a.appointment_date,
    CASE WHEN a.cat_id IS NOT NULL THEN 'YES' ELSE 'NO' END as has_cat,
    ci.id_value as microchip
FROM trapper.sot_appointments a
LEFT JOIN trapper.cat_identifiers ci ON ci.cat_id = a.cat_id AND ci.id_type = 'microchip'
WHERE a.person_id IN (
    SELECT person_id FROM trapper.sot_people WHERE email ILIKE '%singkeo%'
)
ORDER BY a.appointment_date;

\echo ''
\echo '=== MIG_545 Complete ==='
