-- =====================================================
-- MIG_549: Additional Appointment-Cat Linking Strategies
-- =====================================================
-- Problem: ~4,897 appointments still missing cat_id links
-- Analysis: ~1,850-1,900 fixable, ~3,000+ are legitimate nulls
--
-- New strategies:
-- 1. Match via owner email + cat name from cat_info
-- 2. Cross-reference animal_id between appointment_info and cat_info
-- 3. Add linking_status column to track why appointments are unlinked
--
-- MANUAL APPLY:
--   psql "$DATABASE_URL" -f sql/schema/sot/MIG_549__additional_appointment_cat_linking.sql
-- =====================================================

\echo '=== MIG_549: Additional Appointment-Cat Linking ==='
\echo ''

-- ============================================================
-- 1. Baseline
-- ============================================================

\echo 'Baseline - Appointments without cat_id:'
SELECT
    COUNT(*) as total,
    COUNT(*) FILTER (WHERE cat_id IS NULL) as without_cat,
    COUNT(*) FILTER (WHERE cat_id IS NULL AND (is_spay OR is_neuter)) as unlinked_tnr,
    COUNT(*) FILTER (WHERE cat_id IS NULL AND NOT COALESCE(is_spay, FALSE) AND NOT COALESCE(is_neuter, FALSE)) as unlinked_other
FROM trapper.sot_appointments;

-- ============================================================
-- 2. Add linking_status column for tracking
-- ============================================================

\echo ''
\echo 'Step 1: Adding cat_linking_status column...'

ALTER TABLE trapper.sot_appointments
ADD COLUMN IF NOT EXISTS cat_linking_status TEXT;

COMMENT ON COLUMN trapper.sot_appointments.cat_linking_status IS
'Tracks why cat_id is null: linked, no_microchip, no_animal_id, non_tnr, unresolvable';

-- ============================================================
-- 3. Strategy A: Match via email + cat name
-- ============================================================

\echo ''
\echo 'Step 2: Matching via owner email + cat name...'

-- Build lookup of cats by owner email + name
CREATE TEMP TABLE email_cat_lookup AS
SELECT DISTINCT ON (pi.id_value_norm, LOWER(TRIM(c.display_name)))
    pi.id_value_norm as email_norm,
    c.cat_id,
    LOWER(TRIM(c.display_name)) as cat_name_lower
FROM trapper.person_cat_relationships pcr
JOIN trapper.sot_cats c ON c.cat_id = pcr.cat_id
JOIN trapper.person_identifiers pi ON pi.person_id = pcr.person_id AND pi.id_type = 'email'
WHERE pcr.relationship_type IN ('owner', 'caretaker')
  AND c.display_name IS NOT NULL
  AND c.display_name NOT LIKE 'Cat-%'
  AND c.display_name NOT ILIKE 'Unknown%'
  AND LENGTH(c.display_name) > 2
ORDER BY pi.id_value_norm, LOWER(TRIM(c.display_name)), pcr.created_at DESC;

CREATE INDEX ON email_cat_lookup(email_norm, cat_name_lower);

\echo 'Email-cat lookup entries:'
SELECT COUNT(*) as lookup_entries FROM email_cat_lookup;

-- Link unlinked appointments by email + cat name
WITH matched AS (
  UPDATE trapper.sot_appointments a
  SET cat_id = ecl.cat_id,
      cat_linking_status = 'email_name_match',
      updated_at = NOW()
  FROM trapper.staged_records sr
  JOIN email_cat_lookup ecl ON
      ecl.email_norm = LOWER(TRIM(sr.payload->>'Owner Email'))
      AND ecl.cat_name_lower = LOWER(TRIM(sr.payload->>'Animal Name'))
  WHERE a.source_row_hash = sr.row_hash
    AND a.source_system = 'clinichq'
    AND sr.source_system = 'clinichq'
    AND sr.source_table = 'appointment_info'
    AND a.cat_id IS NULL
    AND sr.payload->>'Owner Email' IS NOT NULL
    AND sr.payload->>'Animal Name' IS NOT NULL
    AND LENGTH(sr.payload->>'Animal Name') > 2
  RETURNING a.appointment_id
)
SELECT COUNT(*) as linked_via_email_name FROM matched;

DROP TABLE email_cat_lookup;

\echo 'After email+name matching:'
SELECT COUNT(*) FILTER (WHERE cat_id IS NULL) as still_unlinked FROM trapper.sot_appointments;

-- ============================================================
-- 4. Strategy B: Cross-reference cat_info by animal ID
-- ============================================================

\echo ''
\echo 'Step 3: Cross-referencing cat_info by animal ID...'

-- First, ensure all cats in cat_info have clinichq_animal_id identifiers
INSERT INTO trapper.cat_identifiers (cat_id, id_type, id_value, source_system, source_table)
SELECT DISTINCT
    ci.cat_id,
    'clinichq_animal_id',
    sr.payload->>'Number',
    'clinichq',
    'cat_info'
FROM trapper.staged_records sr
JOIN trapper.cat_identifiers ci ON ci.id_type = 'microchip'
    AND ci.id_value = COALESCE(
        NULLIF(sr.payload->>'Microchip Number', ''),
        (regexp_match(sr.payload->>'Animal Name', '([0-9]{15})'))[1]
    )
WHERE sr.source_system = 'clinichq'
  AND sr.source_table = 'cat_info'
  AND sr.payload->>'Number' IS NOT NULL
  AND LENGTH(sr.payload->>'Number') > 0
ON CONFLICT (id_type, id_value) DO NOTHING;

\echo 'Cat identifiers added from cat_info:'
SELECT COUNT(*) as clinichq_animal_ids
FROM trapper.cat_identifiers
WHERE id_type = 'clinichq_animal_id';

-- Now link appointments via animal ID in cat_info
-- Match appointment number with cat_info number through shared microchip
WITH matched AS (
  UPDATE trapper.sot_appointments a
  SET cat_id = ci.cat_id,
      cat_linking_status = 'cat_info_animal_id',
      updated_at = NOW()
  FROM trapper.staged_records appt_sr
  JOIN trapper.staged_records cat_sr ON cat_sr.source_system = 'clinichq'
      AND cat_sr.source_table = 'cat_info'
      AND cat_sr.payload->>'Number' = appt_sr.payload->>'Number'
  JOIN trapper.cat_identifiers ci ON ci.id_type = 'microchip'
      AND ci.id_value = COALESCE(
          NULLIF(cat_sr.payload->>'Microchip Number', ''),
          (regexp_match(cat_sr.payload->>'Animal Name', '([0-9]{15})'))[1]
      )
  WHERE a.source_row_hash = appt_sr.row_hash
    AND a.source_system = 'clinichq'
    AND appt_sr.source_system = 'clinichq'
    AND appt_sr.source_table = 'appointment_info'
    AND a.cat_id IS NULL
    AND appt_sr.payload->>'Number' IS NOT NULL
  RETURNING a.appointment_id
)
SELECT COUNT(*) as linked_via_cat_info FROM matched;

\echo 'After cat_info cross-reference:'
SELECT COUNT(*) FILTER (WHERE cat_id IS NULL) as still_unlinked FROM trapper.sot_appointments;

-- ============================================================
-- 5. Categorize remaining unlinked appointments
-- ============================================================

\echo ''
\echo 'Step 4: Categorizing remaining unlinked appointments...'

-- Non-TNR services (consultations, exams, etc.)
UPDATE trapper.sot_appointments
SET cat_linking_status = 'non_tnr_service'
WHERE cat_id IS NULL
  AND cat_linking_status IS NULL
  AND NOT COALESCE(is_spay, FALSE)
  AND NOT COALESCE(is_neuter, FALSE);

-- No microchip available in source data
UPDATE trapper.sot_appointments a
SET cat_linking_status = 'no_microchip'
WHERE a.cat_id IS NULL
  AND a.cat_linking_status IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM trapper.staged_records sr
    WHERE sr.row_hash = a.source_row_hash
      AND sr.source_system = 'clinichq'
      AND sr.source_table = 'appointment_info'
      AND (
        LENGTH(COALESCE(sr.payload->>'Microchip Number', '')) > 0
        OR sr.payload->>'Animal Name' ~ '[0-9]{15}'
      )
  );

-- Has data but unresolvable
UPDATE trapper.sot_appointments
SET cat_linking_status = 'unresolvable'
WHERE cat_id IS NULL
  AND cat_linking_status IS NULL;

-- Mark linked appointments
UPDATE trapper.sot_appointments
SET cat_linking_status = 'linked'
WHERE cat_id IS NOT NULL
  AND cat_linking_status IS NULL;

-- ============================================================
-- 6. Verification
-- ============================================================

\echo ''
\echo '====== VERIFICATION ======'

\echo ''
\echo 'Appointment linking summary:'
SELECT
    cat_linking_status,
    COUNT(*) as count,
    ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER (), 1) as pct
FROM trapper.sot_appointments
GROUP BY cat_linking_status
ORDER BY count DESC;

\echo ''
\echo 'Unlinked TNR appointments (spay/neuter without cat):'
SELECT COUNT(*) as unlinked_tnr
FROM trapper.sot_appointments
WHERE cat_id IS NULL
  AND (COALESCE(is_spay, FALSE) OR COALESCE(is_neuter, FALSE));

\echo ''
\echo 'Sample of unresolvable TNR appointments:'
SELECT
    a.appointment_id,
    a.appointment_date,
    a.appointment_type,
    a.appointment_number,
    a.cat_linking_status
FROM trapper.sot_appointments a
WHERE a.cat_id IS NULL
  AND (COALESCE(a.is_spay, FALSE) OR COALESCE(a.is_neuter, FALSE))
  AND a.cat_linking_status = 'unresolvable'
ORDER BY a.appointment_date DESC
LIMIT 10;

\echo ''
\echo 'Service type distribution for unlinked appointments:'
SELECT
    COALESCE(appointment_type, 'NULL') as service_type,
    cat_linking_status,
    COUNT(*) as count
FROM trapper.sot_appointments
WHERE cat_id IS NULL
GROUP BY appointment_type, cat_linking_status
ORDER BY count DESC
LIMIT 20;

\echo ''
\echo '=== MIG_549 Complete ==='
