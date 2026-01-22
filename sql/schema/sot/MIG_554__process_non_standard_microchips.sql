-- =====================================================
-- MIG_554: Process Non-Standard Microchips
-- =====================================================
-- Processes existing unlinked appointments to find and link
-- non-standard microchip formats (9, 10, 14 digit).
--
-- Prerequisites: MIG_553 must be applied first.
--
-- MANUAL APPLY:
--   psql "$DATABASE_URL" -f sql/schema/sot/MIG_554__process_non_standard_microchips.sql
-- =====================================================

\echo '=== MIG_554: Process Non-Standard Microchips ==='
\echo ''

-- ============================================================
-- 1. Baseline: Check current unlinked counts
-- ============================================================

\echo 'Baseline - Current linking status:'
SELECT
    cat_linking_status,
    COUNT(*) as count,
    ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER (), 2) as pct
FROM trapper.sot_appointments
GROUP BY cat_linking_status
ORDER BY count DESC;

\echo ''
\echo 'Unlinked appointments with potential microchips (9+ digits):'
SELECT COUNT(*) as potential_chips
FROM trapper.sot_appointments a
JOIN trapper.staged_records sr ON sr.row_hash = a.source_row_hash
  AND sr.source_system = 'clinichq' AND sr.source_table = 'appointment_info'
WHERE a.cat_id IS NULL
  AND sr.payload->>'Animal Name' ~ '[0-9]{9,}';

-- ============================================================
-- 2. Analyze what we'll find
-- ============================================================

\echo ''
\echo 'Step 1: Analyzing potential microchip formats in unlinked appointments...'

CREATE TEMP TABLE _analysis AS
SELECT
  sr.payload->>'Animal Name' as animal_name,
  regexp_replace(sr.payload->>'Animal Name', '[^0-9A-Za-z\.\-]', '', 'g') as raw_value,
  detected.*,
  COUNT(*) as appointment_count
FROM trapper.sot_appointments a
JOIN trapper.staged_records sr ON sr.row_hash = a.source_row_hash
  AND sr.source_system = 'clinichq' AND sr.source_table = 'appointment_info'
LEFT JOIN LATERAL trapper.detect_microchip_format(
  regexp_replace(sr.payload->>'Animal Name', '[^0-9A-Za-z\.\-]', '', 'g')
) detected ON TRUE
WHERE a.cat_id IS NULL
  AND sr.payload->>'Animal Name' ~ '[0-9]{9,}'
GROUP BY sr.payload->>'Animal Name', 2, detected.cleaned_value, detected.id_type, detected.confidence, detected.notes;

\echo ''
\echo 'Format distribution in unlinked appointments:'
SELECT
  COALESCE(id_type, 'unrecognized') as format_type,
  confidence,
  COUNT(*) as unique_chips,
  SUM(appointment_count) as total_appointments
FROM _analysis
GROUP BY id_type, confidence
ORDER BY total_appointments DESC;

\echo ''
\echo 'Sample of each format type:'
SELECT DISTINCT ON (id_type)
  id_type,
  animal_name,
  cleaned_value,
  confidence,
  notes
FROM _analysis
WHERE id_type IS NOT NULL
ORDER BY id_type, appointment_count DESC;

DROP TABLE _analysis;

-- ============================================================
-- 3. Run the extraction function
-- ============================================================

\echo ''
\echo 'Step 2: Running extract_and_link_microchips_from_animal_name()...'

SELECT * FROM trapper.extract_and_link_microchips_from_animal_name();

-- ============================================================
-- 4. Update remaining unlinked statuses
-- ============================================================

\echo ''
\echo 'Step 3: Updating status for remaining unlinked appointments...'

-- Appointments with potential chips but couldn't be linked (shelter IDs, etc.)
UPDATE trapper.sot_appointments a
SET cat_linking_status = 'shelter_id_not_microchip'
FROM trapper.staged_records sr
JOIN LATERAL trapper.detect_microchip_format(
  regexp_replace(sr.payload->>'Animal Name', '[^0-9A-Za-z\.\-]', '', 'g')
) detected ON TRUE
WHERE a.source_row_hash = sr.row_hash
  AND a.source_system = 'clinichq'
  AND sr.source_system = 'clinichq'
  AND sr.source_table = 'appointment_info'
  AND a.cat_id IS NULL
  AND a.cat_linking_status IS NULL
  AND detected.id_type = 'shelter_animal_id';

\echo 'Marked shelter IDs:';
SELECT COUNT(*) as shelter_ids_marked FROM trapper.sot_appointments WHERE cat_linking_status = 'shelter_id_not_microchip';

-- Appointments with numeric values that didn't match any format
UPDATE trapper.sot_appointments a
SET cat_linking_status = 'unrecognized_format'
FROM trapper.staged_records sr
WHERE a.source_row_hash = sr.row_hash
  AND a.source_system = 'clinichq'
  AND sr.source_system = 'clinichq'
  AND sr.source_table = 'appointment_info'
  AND a.cat_id IS NULL
  AND a.cat_linking_status IS NULL
  AND sr.payload->>'Animal Name' ~ '[0-9]{5,}'  -- Has numbers but wasn't recognized
  AND NOT EXISTS (
    SELECT 1 FROM trapper.detect_microchip_format(
      regexp_replace(sr.payload->>'Animal Name', '[^0-9A-Za-z\.\-]', '', 'g')
    ) WHERE id_type IS NOT NULL
  );

-- ============================================================
-- 5. Verification
-- ============================================================

\echo ''
\echo '====== VERIFICATION ======'

\echo ''
\echo 'Updated linking status summary:'
SELECT
    cat_linking_status,
    COUNT(*) as count,
    ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER (), 2) as pct
FROM trapper.sot_appointments
GROUP BY cat_linking_status
ORDER BY count DESC;

\echo ''
\echo 'Cat identifiers by type:'
SELECT
  id_type,
  format_confidence,
  COUNT(*) as count
FROM trapper.cat_identifiers
GROUP BY id_type, format_confidence
ORDER BY count DESC;

\echo ''
\echo 'Newly created cats with non-standard chips:'
SELECT
  c.cat_id,
  c.display_name,
  ci.id_type,
  ci.id_value,
  ci.format_notes,
  ci.format_confidence
FROM trapper.sot_cats c
JOIN trapper.cat_identifiers ci ON ci.cat_id = c.cat_id
WHERE ci.id_type IN ('microchip_avid', 'microchip_10digit', 'microchip_truncated')
  AND c.created_at > NOW() - INTERVAL '10 minutes'
ORDER BY ci.id_type, c.display_name;

\echo ''
\echo 'Remaining unlinked TNR appointments (spay/neuter):'
SELECT COUNT(*) as unlinked_tnr
FROM trapper.sot_appointments
WHERE cat_id IS NULL
  AND (COALESCE(is_spay, FALSE) OR COALESCE(is_neuter, FALSE));

\echo ''
\echo '=== MIG_554 Complete ==='
\echo ''
\echo 'Summary:'
\echo '  - All recognizable microchip formats (9, 10, 14, 15 digit) now processed'
\echo '  - Shelter IDs (A + digits) separated from microchips'
\echo '  - Format confidence tracked in cat_identifiers table'
\echo '  - Unrecoverable records clearly categorized'
