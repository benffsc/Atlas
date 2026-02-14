-- MIG_212__fix_appointment_cat_linking.sql
-- Fix appointment-to-cat linking with fallback strategies
--
-- Problem:
--   5,739 appointments have no cat linked because:
--   1. 456 are empty rows (junk) - ignore
--   2. 1,067 have microchip in Animal Name field instead of Microchip Number
--   3. 3,565 have no microchip but DO have clinichq_animal_id (Number field)
--
-- Solution:
--   1. Extract microchips from Animal Name field
--   2. Link appointments via microchip (primary)
--   3. Fallback to clinichq_animal_id (Number field)
--   4. Update cat_place_relationships for newly linked cats
--
-- MANUAL APPLY:
--   export $(cat .env | grep -v '^#' | xargs)
--   psql "$DATABASE_URL" -f sql/schema/sot/MIG_212__fix_appointment_cat_linking.sql

\echo ''
\echo 'MIG_212: Fix Appointment-Cat Linking'
\echo '====================================='
\echo ''

-- ============================================================
-- 1. Baseline: Count unlinked appointments
-- ============================================================

\echo 'Baseline - Appointments without cat links:'
SELECT
    COUNT(*) as total_appointments,
    COUNT(*) FILTER (WHERE cat_id IS NULL) as unlinked,
    COUNT(*) FILTER (WHERE cat_id IS NOT NULL) as linked
FROM trapper.sot_appointments;

-- ============================================================
-- 2. Extract microchips from Animal Name field
-- ============================================================

\echo ''
\echo 'Step 1: Extracting microchips from Animal Name field...'

-- Create temp table with extracted microchips
CREATE TEMP TABLE extracted_microchips AS
SELECT
    sr.source_row_id,
    sr.row_hash,
    sr.payload->>'Number' as animal_number,
    (regexp_match(sr.payload->>'Animal Name', '([0-9]{15})'))[1] as extracted_microchip
FROM trapper.staged_records sr
WHERE sr.source_system = 'clinichq'
  AND sr.source_table = 'appointment_info'
  AND sr.payload->>'Animal Name' ~ '[0-9]{15}'
  AND COALESCE(sr.payload->>'Microchip Number', '') = '';

\echo 'Extracted microchips from name field:'
SELECT COUNT(*) as records_with_chip_in_name FROM extracted_microchips;

-- Add these microchips to cat_identifiers if the cat exists via animal_id
INSERT INTO trapper.cat_identifiers (cat_id, id_type, id_value, source_system, source_table)
SELECT DISTINCT
    ci.cat_id,
    'microchip',
    em.extracted_microchip,
    'clinichq',
    'appointment_info_recovery'
FROM extracted_microchips em
JOIN trapper.cat_identifiers ci ON ci.id_type = 'clinichq_animal_id' AND ci.id_value = em.animal_number
WHERE NOT EXISTS (
    SELECT 1 FROM trapper.cat_identifiers ci2
    WHERE ci2.cat_id = ci.cat_id AND ci2.id_type = 'microchip' AND ci2.id_value = em.extracted_microchip
)
ON CONFLICT DO NOTHING;

\echo 'Added recovered microchips to cat_identifiers:'
SELECT COUNT(*) FROM trapper.cat_identifiers WHERE source_table = 'appointment_info_recovery';

DROP TABLE extracted_microchips;

-- ============================================================
-- 3. Link appointments via microchip (re-run with recovered chips)
-- ============================================================

\echo ''
\echo 'Step 2: Re-linking appointments via microchip (including recovered)...'

UPDATE trapper.sot_appointments a
SET cat_id = ci.cat_id,
    updated_at = NOW()
FROM trapper.staged_records sr
JOIN trapper.cat_identifiers ci ON ci.id_type = 'microchip'
    AND ci.id_value = sr.payload->>'Microchip Number'
WHERE a.source_row_hash = sr.row_hash
  AND a.source_system = 'clinichq'
  AND sr.source_system = 'clinichq'
  AND sr.source_table = 'appointment_info'
  AND a.cat_id IS NULL
  AND LENGTH(COALESCE(sr.payload->>'Microchip Number', '')) > 0;

\echo 'Appointments linked via microchip:'
SELECT COUNT(*) as still_unlinked FROM trapper.sot_appointments WHERE cat_id IS NULL;

-- ============================================================
-- 4. Link appointments via extracted microchip from name
-- ============================================================

\echo ''
\echo 'Step 3: Linking appointments via microchip extracted from Animal Name...'

UPDATE trapper.sot_appointments a
SET cat_id = ci.cat_id,
    updated_at = NOW()
FROM trapper.staged_records sr
JOIN trapper.cat_identifiers ci ON ci.id_type = 'microchip'
    AND ci.id_value = (regexp_match(sr.payload->>'Animal Name', '([0-9]{15})'))[1]
WHERE a.source_row_hash = sr.row_hash
  AND a.source_system = 'clinichq'
  AND sr.source_system = 'clinichq'
  AND sr.source_table = 'appointment_info'
  AND a.cat_id IS NULL
  AND sr.payload->>'Animal Name' ~ '[0-9]{15}';

\echo 'After linking via name-embedded microchip:'
SELECT COUNT(*) as still_unlinked FROM trapper.sot_appointments WHERE cat_id IS NULL;

-- ============================================================
-- 5. Fallback: Link via clinichq_animal_id (Number field)
-- ============================================================

\echo ''
\echo 'Step 4: Fallback linking via clinichq_animal_id (Number field)...'

UPDATE trapper.sot_appointments a
SET cat_id = ci.cat_id,
    updated_at = NOW()
FROM trapper.cat_identifiers ci
WHERE ci.id_type = 'clinichq_animal_id'
  AND ci.id_value = a.appointment_number
  AND a.cat_id IS NULL
  AND a.appointment_number IS NOT NULL
  AND LENGTH(a.appointment_number) > 0;

\echo 'After fallback linking via animal_id:'
SELECT COUNT(*) as still_unlinked FROM trapper.sot_appointments WHERE cat_id IS NULL;

-- ============================================================
-- 5.5. Add missing clinichq_animal_id identifiers via microchip match
-- ============================================================

\echo ''
\echo 'Step 5.5: Adding missing clinichq_animal_id identifiers...'

INSERT INTO trapper.cat_identifiers (cat_id, id_type, id_value, source_system, source_table)
SELECT DISTINCT
    ci.cat_id,
    'clinichq_animal_id',
    sr.payload->>'Number',
    'clinichq',
    'cat_info'
FROM trapper.staged_records sr
JOIN trapper.cat_identifiers ci ON ci.id_type = 'microchip'
    AND ci.id_value = sr.payload->>'Microchip Number'
WHERE sr.source_system = 'clinichq'
  AND sr.source_table = 'cat_info'
  AND sr.payload->>'Number' IS NOT NULL
  AND LENGTH(sr.payload->>'Number') > 0
  AND NOT EXISTS (
    SELECT 1 FROM trapper.cat_identifiers ci2
    WHERE ci2.cat_id = ci.cat_id
      AND ci2.id_type = 'clinichq_animal_id'
      AND ci2.id_value = sr.payload->>'Number'
  )
ON CONFLICT DO NOTHING;

\echo 'Total clinichq_animal_id identifiers:'
SELECT COUNT(*) FROM trapper.cat_identifiers WHERE id_type = 'clinichq_animal_id';

-- Re-run fallback linking with new identifiers
\echo ''
\echo 'Step 5.6: Re-running fallback linking with new identifiers...'

UPDATE trapper.sot_appointments a
SET cat_id = ci.cat_id,
    updated_at = NOW()
FROM trapper.cat_identifiers ci
WHERE ci.id_type = 'clinichq_animal_id'
  AND ci.id_value = a.appointment_number
  AND a.cat_id IS NULL
  AND a.appointment_number IS NOT NULL
  AND LENGTH(a.appointment_number) > 0;

\echo 'After additional linking:'
SELECT COUNT(*) as still_unlinked FROM trapper.sot_appointments WHERE cat_id IS NULL;

-- ============================================================
-- 6. Update cat_place_relationships for newly linked cats
-- ============================================================

\echo ''
\echo 'Step 6: Creating cat_place_relationships for newly linked appointments...'

-- Insert cat-place relationships for appointments that now have both cat and place
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
    'procedure',
    'clinichq',
    'appointment_info'
FROM trapper.sot_appointments a
WHERE a.cat_id IS NOT NULL
  AND a.place_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM trapper.cat_place_relationships cpr
    WHERE cpr.cat_id = a.cat_id AND cpr.place_id = a.place_id
  )
ON CONFLICT DO NOTHING;

\echo 'Cat-place relationships after update:'
SELECT COUNT(*) as total_relationships FROM trapper.cat_place_relationships;

-- ============================================================
-- 7. Update cat_procedures for newly linked appointments
-- ============================================================

\echo ''
\echo 'Step 7: Updating cat_procedures for spay/neuter appointments...'

-- Insert procedures for linked appointments with spay/neuter
INSERT INTO trapper.cat_procedures (
    cat_id,
    appointment_id,
    procedure_type,
    procedure_date,
    is_spay,
    is_neuter,
    performed_by,
    source_system,
    source_record_id
)
SELECT DISTINCT ON (a.cat_id, a.appointment_date, a.is_spay, a.is_neuter)
    a.cat_id,
    a.appointment_id,
    CASE
        WHEN a.is_spay THEN 'spay'
        WHEN a.is_neuter THEN 'neuter'
        ELSE 'other'
    END as procedure_type,
    a.appointment_date,
    a.is_spay,
    a.is_neuter,
    a.vet_name,
    'clinichq',
    a.source_record_id
FROM trapper.sot_appointments a
WHERE a.cat_id IS NOT NULL
  AND (a.is_spay OR a.is_neuter)
  AND NOT EXISTS (
    SELECT 1 FROM trapper.cat_procedures cp
    WHERE cp.cat_id = a.cat_id
      AND cp.procedure_date = a.appointment_date
      AND cp.is_spay = a.is_spay
      AND cp.is_neuter = a.is_neuter
  )
ORDER BY a.cat_id, a.appointment_date, a.is_spay, a.is_neuter, a.created_at
ON CONFLICT DO NOTHING;

\echo 'Cat procedures after update:'
SELECT COUNT(*) as total_procedures FROM trapper.cat_procedures;

-- ============================================================
-- 8. Update place activity flags
-- ============================================================

\echo ''
\echo 'Step 7: Updating place activity flags...'

UPDATE trapper.places p
SET
    has_cat_activity = TRUE,
    last_activity_at = GREATEST(p.last_activity_at, sub.last_appt),
    updated_at = NOW()
FROM (
    SELECT
        a.place_id,
        MAX(a.appointment_date) as last_appt
    FROM trapper.sot_appointments a
    WHERE a.cat_id IS NOT NULL AND a.place_id IS NOT NULL
    GROUP BY a.place_id
) sub
WHERE p.place_id = sub.place_id
  AND (p.has_cat_activity = FALSE OR p.has_cat_activity IS NULL);

-- ============================================================
-- 9. Verification
-- ============================================================

\echo ''
\echo '====== VERIFICATION ======'
\echo ''

\echo 'Final appointment linking status:'
SELECT
    COUNT(*) as total_appointments,
    COUNT(*) FILTER (WHERE cat_id IS NULL) as unlinked,
    COUNT(*) FILTER (WHERE cat_id IS NOT NULL) as linked,
    ROUND(100.0 * COUNT(*) FILTER (WHERE cat_id IS NOT NULL) / COUNT(*), 1) as pct_linked
FROM trapper.sot_appointments;

\echo ''
\echo 'Cats with place relationships:'
SELECT
    COUNT(DISTINCT c.cat_id) as total_cats,
    COUNT(DISTINCT c.cat_id) FILTER (WHERE EXISTS (
        SELECT 1 FROM trapper.cat_place_relationships cpr WHERE cpr.cat_id = c.cat_id
    )) as with_place
FROM trapper.sot_cats c;

\echo ''
\echo 'Places with cat activity:'
SELECT
    COUNT(*) as total_places,
    COUNT(*) FILTER (WHERE has_cat_activity) as with_cat_activity
FROM trapper.places;

\echo ''
\echo 'Colony data coverage (places with A_known > 0):'
SELECT COUNT(*) as places_with_verified_altered
FROM trapper.v_place_ecology_stats
WHERE a_known > 0;

SELECT 'MIG_212 Complete' AS status;
