-- =====================================================
-- MIG_552: Automatic Microchip Extraction from Animal Name
-- =====================================================
-- Creates a reusable function to extract microchips from the
-- Animal Name field during ClinicHQ ingest.
--
-- This function can be:
-- 1. Called manually after any ingest
-- 2. Added to the unified processing pipeline
-- 3. Called from a cron job
--
-- MANUAL APPLY:
--   psql "$DATABASE_URL" -f sql/schema/sot/MIG_552__auto_extract_microchip_from_name.sql
-- =====================================================

\echo '=== MIG_552: Automatic Microchip Extraction from Animal Name ==='
\echo ''

-- ============================================================
-- 1. Create the reusable extraction function
-- ============================================================

\echo 'Step 1: Creating extract_and_link_microchips_from_animal_name function...'

CREATE OR REPLACE FUNCTION trapper.extract_and_link_microchips_from_animal_name()
RETURNS TABLE (
  cats_created INT,
  identifiers_created INT,
  appointments_linked INT
) AS $$
DECLARE
  v_cats_created INT := 0;
  v_identifiers_created INT := 0;
  v_appointments_linked INT := 0;
  r RECORD;
BEGIN
  -- Step 1: Find microchips in Animal Name that don't have cat_identifiers yet
  CREATE TEMP TABLE IF NOT EXISTS _temp_missing_microchips (
    microchip TEXT PRIMARY KEY,
    cat_name TEXT,
    sex TEXT
  ) ON COMMIT DROP;

  TRUNCATE _temp_missing_microchips;

  INSERT INTO _temp_missing_microchips (microchip, cat_name, sex)
  SELECT DISTINCT
    (regexp_match(sr.payload->>'Animal Name', '([0-9]{15})'))[1] as microchip,
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
  GROUP BY 1, 2
  ON CONFLICT (microchip) DO NOTHING;

  -- Step 2: Create cats for missing microchips
  FOR r IN SELECT * FROM _temp_missing_microchips WHERE microchip IS NOT NULL
  LOOP
    BEGIN
      INSERT INTO trapper.sot_cats (
        cat_id,
        display_name,
        sex,
        data_source,
        created_at
      ) VALUES (
        gen_random_uuid(),
        COALESCE(NULLIF(r.cat_name, ''), 'Cat-' || r.microchip),
        CASE
          WHEN r.sex ILIKE '%female%' THEN 'female'
          WHEN r.sex ILIKE '%male%' THEN 'male'
          ELSE 'unknown'
        END,
        'clinichq'::trapper.data_source,
        NOW()
      );
      v_cats_created := v_cats_created + 1;
    EXCEPTION WHEN unique_violation THEN
      -- Cat already exists with this name, skip
      NULL;
    END;
  END LOOP;

  -- Step 3: Create cat_identifiers for new cats
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
  FROM _temp_missing_microchips mm
  JOIN trapper.sot_cats c ON c.display_name = COALESCE(NULLIF(mm.cat_name, ''), 'Cat-' || mm.microchip)
  WHERE mm.microchip IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM trapper.cat_identifiers ci2
      WHERE ci2.id_type = 'microchip' AND ci2.id_value = mm.microchip
    )
  ON CONFLICT (id_type, id_value) DO NOTHING;

  GET DIAGNOSTICS v_identifiers_created = ROW_COUNT;

  -- Step 4: Link appointments to cats via microchip in Animal Name
  WITH linked AS (
    UPDATE trapper.sot_appointments a
    SET cat_id = ci.cat_id,
        cat_linking_status = 'linked_via_animal_name_auto',
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
  SELECT COUNT(*) INTO v_appointments_linked FROM linked;

  DROP TABLE IF EXISTS _temp_missing_microchips;

  RETURN QUERY SELECT v_cats_created, v_identifiers_created, v_appointments_linked;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.extract_and_link_microchips_from_animal_name() IS
'Extracts microchips from the Animal Name field for appointments that have no cat_id.
Creates cats if they don''t exist, then links appointments.
Returns counts of cats_created, identifiers_created, appointments_linked.
Call after ClinicHQ ingest or from cron job.';

-- ============================================================
-- 2. Test the function
-- ============================================================

\echo ''
\echo 'Step 2: Testing the function...'

SELECT * FROM trapper.extract_and_link_microchips_from_animal_name();

-- ============================================================
-- 3. Verification
-- ============================================================

\echo ''
\echo '====== VERIFICATION ======'

\echo ''
\echo 'Function created:'
SELECT routine_name, routine_type
FROM information_schema.routines
WHERE routine_schema = 'trapper'
  AND routine_name = 'extract_and_link_microchips_from_animal_name';

\echo ''
\echo 'Remaining unlinked appointments with microchip in Animal Name:'
SELECT COUNT(*) as remaining
FROM trapper.sot_appointments a
JOIN trapper.staged_records sr ON sr.row_hash = a.source_row_hash
  AND sr.source_system = 'clinichq' AND sr.source_table = 'appointment_info'
WHERE a.cat_id IS NULL
  AND sr.payload->>'Animal Name' ~ '[0-9]{15}';

\echo ''
\echo 'Final linking status summary:'
SELECT
    cat_linking_status,
    COUNT(*) as count,
    ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER (), 1) as pct
FROM trapper.sot_appointments
GROUP BY cat_linking_status
ORDER BY count DESC;

\echo ''
\echo '=== MIG_552 Complete ==='
\echo ''
\echo 'USAGE: After each ClinicHQ ingest, run:'
\echo '  SELECT * FROM trapper.extract_and_link_microchips_from_animal_name();'
\echo ''
\echo 'Or add to the unified processing pipeline in process_clinichq_cat_info().'
