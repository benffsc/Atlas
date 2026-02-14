-- =====================================================
-- MIG_551: Fix Animal Name Microchips
-- =====================================================
-- Problem: 263 appointments have microchips in the Animal Name field
-- but cats weren't created due to schema mismatch (used source_system
-- instead of data_source column).
--
-- Solution: Create cats with correct schema, then link appointments.
--
-- MANUAL APPLY:
--   psql "$DATABASE_URL" -f sql/schema/sot/MIG_551__fix_animal_name_microchips.sql
-- =====================================================

\echo '=== MIG_551: Fix Animal Name Microchips ==='
\echo ''

-- ============================================================
-- 1. Baseline: Count unlinked appointments with microchips in name
-- ============================================================

\echo 'Baseline - Appointments with microchips in Animal Name:'
SELECT COUNT(*) as unlinked_with_chip_in_name
FROM trapper.sot_appointments a
JOIN trapper.staged_records sr ON sr.row_hash = a.source_row_hash
  AND sr.source_system = 'clinichq' AND sr.source_table = 'appointment_info'
WHERE a.cat_id IS NULL
  AND sr.payload->>'Animal Name' ~ '[0-9]{15}';

-- ============================================================
-- 2. Extract unique microchips that need cats created
-- ============================================================

\echo ''
\echo 'Step 1: Identifying microchips that need cats...'

CREATE TEMP TABLE missing_microchips AS
SELECT DISTINCT
  (regexp_match(sr.payload->>'Animal Name', '([0-9]{15})'))[1] as microchip,
  -- Extract cat name (everything before the microchip, or everything after)
  CASE
    WHEN TRIM(regexp_replace(sr.payload->>'Animal Name', '[0-9]{15}.*', '')) <> ''
    THEN TRIM(regexp_replace(sr.payload->>'Animal Name', '[0-9]{15}.*', ''))
    WHEN TRIM(regexp_replace(sr.payload->>'Animal Name', '.*[0-9]{15}\s*', '')) <> ''
    THEN TRIM(regexp_replace(sr.payload->>'Animal Name', '.*[0-9]{15}\s*', ''))
    ELSE NULL
  END as cat_name,
  MAX(sr.payload->>'Sex') as sex
FROM trapper.sot_appointments a
JOIN trapper.staged_records sr ON sr.row_hash = a.source_row_hash
  AND sr.source_system = 'clinichq' AND sr.source_table = 'appointment_info'
WHERE a.cat_id IS NULL
  AND sr.payload->>'Animal Name' ~ '[0-9]{15}'
  AND NOT EXISTS (
    SELECT 1 FROM trapper.cat_identifiers ci
    WHERE ci.id_type = 'microchip'
    AND ci.id_value = (regexp_match(sr.payload->>'Animal Name', '([0-9]{15})'))[1]
  )
GROUP BY 1, 2;

\echo 'Microchips needing cats:'
SELECT COUNT(*) as microchips_to_create FROM missing_microchips;

\echo ''
\echo 'Sample of microchips to create:'
SELECT * FROM missing_microchips LIMIT 10;

-- ============================================================
-- 3. Create cats with correct schema (data_source, not source_system)
-- ============================================================

\echo ''
\echo 'Step 2: Creating cats...'

INSERT INTO trapper.sot_cats (
  cat_id,
  display_name,
  sex,
  data_source,
  created_at
)
SELECT
  gen_random_uuid(),
  COALESCE(NULLIF(cat_name, ''), 'Cat-' || microchip),
  CASE
    WHEN sex ILIKE '%female%' THEN 'female'
    WHEN sex ILIKE '%male%' THEN 'male'
    ELSE 'unknown'
  END,
  'clinichq'::trapper.data_source,
  NOW()
FROM missing_microchips
WHERE microchip IS NOT NULL;

\echo 'Cats created:'
SELECT COUNT(*) as new_cats
FROM trapper.sot_cats
WHERE created_at > NOW() - INTERVAL '1 minute';

-- ============================================================
-- 4. Create cat_identifiers for new cats
-- ============================================================

\echo ''
\echo 'Step 3: Creating cat identifiers...'

-- Match cats by display_name to get their IDs and link to microchips
INSERT INTO trapper.cat_identifiers (
  cat_id,
  id_type,
  id_value,
  source_system,
  source_table
)
SELECT DISTINCT
  c.cat_id,
  'microchip',
  mm.microchip,
  'clinichq',
  'appointment_info'
FROM missing_microchips mm
JOIN trapper.sot_cats c ON c.display_name = COALESCE(NULLIF(mm.cat_name, ''), 'Cat-' || mm.microchip)
  AND c.created_at > NOW() - INTERVAL '5 minutes'
WHERE mm.microchip IS NOT NULL
ON CONFLICT (id_type, id_value) DO NOTHING;

\echo 'Cat identifiers created:'
SELECT COUNT(*) as new_identifiers
FROM trapper.cat_identifiers
WHERE created_at > NOW() - INTERVAL '1 minute';

DROP TABLE missing_microchips;

-- ============================================================
-- 5. Link appointments to newly created cats
-- ============================================================

\echo ''
\echo 'Step 4: Linking appointments to cats...'

WITH linked AS (
  UPDATE trapper.sot_appointments a
  SET cat_id = ci.cat_id,
      cat_linking_status = 'linked_via_animal_name_MIG_551',
      updated_at = NOW()
  FROM trapper.staged_records sr
  JOIN trapper.cat_identifiers ci ON ci.id_type = 'microchip'
    AND ci.id_value = (regexp_match(sr.payload->>'Animal Name', '([0-9]{15})'))[1]
  WHERE a.source_row_hash = sr.row_hash
    AND a.source_system = 'clinichq'
    AND sr.source_system = 'clinichq'
    AND sr.source_table = 'appointment_info'
    AND a.cat_id IS NULL
    AND sr.payload->>'Animal Name' ~ '[0-9]{15}'
  RETURNING a.appointment_id
)
SELECT COUNT(*) as appointments_linked FROM linked;

-- ============================================================
-- 6. Verification
-- ============================================================

\echo ''
\echo '====== VERIFICATION ======'

\echo ''
\echo 'Remaining unlinked with microchips in Animal Name:'
SELECT COUNT(*) as remaining
FROM trapper.sot_appointments a
JOIN trapper.staged_records sr ON sr.row_hash = a.source_row_hash
  AND sr.source_system = 'clinichq' AND sr.source_table = 'appointment_info'
WHERE a.cat_id IS NULL
  AND sr.payload->>'Animal Name' ~ '[0-9]{15}';

\echo ''
\echo 'Updated linking status summary:'
SELECT
    cat_linking_status,
    COUNT(*) as count
FROM trapper.sot_appointments
WHERE cat_linking_status IS NOT NULL
GROUP BY cat_linking_status
ORDER BY count DESC;

\echo ''
\echo 'Sample of newly linked appointments:'
SELECT
  a.appointment_id,
  a.appointment_date,
  c.display_name as cat_name,
  ci.id_value as microchip,
  a.cat_linking_status
FROM trapper.sot_appointments a
JOIN trapper.sot_cats c ON c.cat_id = a.cat_id
LEFT JOIN trapper.cat_identifiers ci ON ci.cat_id = c.cat_id AND ci.id_type = 'microchip'
WHERE a.cat_linking_status = 'linked_via_animal_name_MIG_551'
ORDER BY a.appointment_date DESC
LIMIT 10;

\echo ''
\echo '=== MIG_551 Complete ==='
