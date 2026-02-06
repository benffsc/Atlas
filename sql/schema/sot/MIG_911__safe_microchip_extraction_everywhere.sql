-- =====================================================
-- MIG_911: Use Safe Microchip Extraction Everywhere
-- =====================================================
-- Problem: MIG_908's functions use raw regex (\d{9,15}) instead of
-- detect_microchip_format(), bypassing the concatenation fix in MIG_910.
--
-- Solution:
--   1. Update all extraction functions to use detect_microchip_format()
--   2. Add extraction to entity linking chain for automatic processing
--
-- Impact: Ensures consistent, safe microchip extraction across all paths
-- =====================================================

\echo '=== MIG_911: Safe Microchip Extraction Everywhere ==='
\echo ''

-- ============================================================
-- 1. Helper function to extract chip from Animal Name safely
-- ============================================================

\echo 'Step 1: Creating safe extraction helper...'

CREATE OR REPLACE FUNCTION trapper.extract_microchip_from_animal_name(p_animal_name TEXT)
RETURNS TEXT AS $$
DECLARE
  v_result RECORD;
BEGIN
  -- Use detect_microchip_format which handles SL ID + chip concatenation
  SELECT * INTO v_result
  FROM trapper.detect_microchip_format(p_animal_name)
  WHERE id_type = 'microchip'
    AND confidence != 'reject'
  LIMIT 1;

  RETURN v_result.cleaned_value;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

COMMENT ON FUNCTION trapper.extract_microchip_from_animal_name(TEXT) IS
'Safely extracts microchip from Animal Name field using detect_microchip_format().
Handles SL ID + chip concatenation (e.g., "Macy - A439019 - 981020039875779").
Returns NULL if no valid chip found.';

-- ============================================================
-- 2. Update link_appointments_via_embedded_microchips
-- ============================================================

\echo ''
\echo 'Step 2: Updating link_appointments_via_embedded_microchips...'

CREATE OR REPLACE FUNCTION trapper.link_appointments_via_embedded_microchips()
RETURNS TABLE (
  operation TEXT,
  count INT
) AS $$
DECLARE
  v_linked INT := 0;
  v_created INT := 0;
  rec RECORD;
BEGIN
  -- Step 1: Link to existing cats via safely extracted microchip
  WITH extracted_chips AS (
    SELECT
      a.appointment_id,
      trapper.extract_microchip_from_animal_name(sr.payload->>'Animal Name') AS extracted_chip,
      sr.payload->>'Animal Name' AS animal_name
    FROM trapper.sot_appointments a
    JOIN trapper.staged_records sr ON sr.source_row_id = a.source_record_id
      AND sr.source_system = 'clinichq'
      AND sr.source_table = 'appointment_info'
    WHERE a.cat_id IS NULL
      AND sr.payload->>'Animal Name' ~ '\d{9,}'
  ),
  linkable AS (
    SELECT ec.appointment_id, ci.cat_id
    FROM extracted_chips ec
    JOIN trapper.cat_identifiers ci
      ON ci.id_value = ec.extracted_chip
      AND ci.id_type = 'microchip'
    JOIN trapper.sot_cats c ON c.cat_id = ci.cat_id
      AND c.merged_into_cat_id IS NULL
    WHERE ec.extracted_chip IS NOT NULL
  ),
  linked AS (
    UPDATE trapper.sot_appointments a
    SET cat_id = l.cat_id,
        cat_linking_status = 'linked_via_embedded_microchip',
        updated_at = NOW()
    FROM linkable l
    WHERE a.appointment_id = l.appointment_id
      AND a.cat_id IS NULL
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_linked FROM linked;

  operation := 'appointments_linked_to_existing_cats';
  count := v_linked;
  RETURN NEXT;

  -- Step 2: Report chips not in system (don't auto-create)
  WITH new_chips AS (
    SELECT DISTINCT
      trapper.extract_microchip_from_animal_name(sr.payload->>'Animal Name') AS extracted_chip
    FROM trapper.sot_appointments a
    JOIN trapper.staged_records sr ON sr.source_row_id = a.source_record_id
      AND sr.source_system = 'clinichq'
      AND sr.source_table = 'appointment_info'
    WHERE a.cat_id IS NULL
      AND sr.payload->>'Animal Name' ~ '\d{9,}'
      AND trapper.extract_microchip_from_animal_name(sr.payload->>'Animal Name') IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM trapper.cat_identifiers ci
        WHERE ci.id_value = trapper.extract_microchip_from_animal_name(sr.payload->>'Animal Name')
          AND ci.id_type = 'microchip'
      )
  )
  SELECT COUNT(*) INTO v_created FROM new_chips;

  operation := 'chips_not_in_system_would_need_cats';
  count := v_created;
  RETURN NEXT;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.link_appointments_via_embedded_microchips() IS
'Links appointments to cats via microchip embedded in Animal Name field.
MIG_911: Now uses extract_microchip_from_animal_name() for safe extraction.';

-- ============================================================
-- 3. Update create_cats_from_embedded_microchips
-- ============================================================

\echo ''
\echo 'Step 3: Updating create_cats_from_embedded_microchips...'

CREATE OR REPLACE FUNCTION trapper.create_cats_from_embedded_microchips()
RETURNS TABLE (
  operation TEXT,
  count INT
) AS $$
DECLARE
  v_created INT := 0;
  v_linked INT := 0;
  rec RECORD;
  v_cat_id UUID;
BEGIN
  -- Create cats for each unique new microchip (using safe extraction)
  FOR rec IN
    WITH new_chips AS (
      SELECT DISTINCT ON (trapper.extract_microchip_from_animal_name(sr.payload->>'Animal Name'))
        trapper.extract_microchip_from_animal_name(sr.payload->>'Animal Name') AS extracted_chip,
        sr.payload->>'Animal Name' AS animal_name,
        -- Extract cat name by removing digits and cleanup
        TRIM(regexp_replace(
          regexp_replace(sr.payload->>'Animal Name', '\d{9,}', '', 'g'),
          '[-"''A]\d*', '', 'g'
        )) AS cat_name,
        sr.payload->>'Sex' AS sex,
        a.appointment_id
      FROM trapper.sot_appointments a
      JOIN trapper.staged_records sr ON sr.source_row_id = a.source_record_id
        AND sr.source_system = 'clinichq'
        AND sr.source_table = 'appointment_info'
      WHERE a.cat_id IS NULL
        AND sr.payload->>'Animal Name' ~ '\d{9,}'
        AND trapper.extract_microchip_from_animal_name(sr.payload->>'Animal Name') IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM trapper.cat_identifiers ci
          WHERE ci.id_value = trapper.extract_microchip_from_animal_name(sr.payload->>'Animal Name')
            AND ci.id_type = 'microchip'
        )
      ORDER BY trapper.extract_microchip_from_animal_name(sr.payload->>'Animal Name'), a.appointment_date DESC
    )
    SELECT * FROM new_chips
    WHERE extracted_chip IS NOT NULL
      AND LENGTH(extracted_chip) >= 9
      AND LENGTH(extracted_chip) <= 15
  LOOP
    -- Use find_or_create_cat_by_microchip with correct signature
    SELECT trapper.find_or_create_cat_by_microchip(
      p_microchip := rec.extracted_chip,
      p_name := NULLIF(TRIM(rec.cat_name), ''),
      p_sex := CASE
        WHEN rec.sex ILIKE '%female%' OR rec.sex = 'F' THEN 'female'
        WHEN rec.sex ILIKE '%male%' OR rec.sex = 'M' THEN 'male'
        ELSE NULL
      END,
      p_source_system := 'clinichq'
    ) INTO v_cat_id;

    IF v_cat_id IS NOT NULL THEN
      v_created := v_created + 1;
    END IF;
  END LOOP;

  operation := 'cats_created_from_embedded_chips';
  count := v_created;
  RETURN NEXT;

  -- Now link all remaining appointments with these new cats
  WITH newly_linkable AS (
    SELECT
      a.appointment_id,
      ci.cat_id
    FROM trapper.sot_appointments a
    JOIN trapper.staged_records sr ON sr.source_row_id = a.source_record_id
      AND sr.source_system = 'clinichq'
      AND sr.source_table = 'appointment_info'
    JOIN trapper.cat_identifiers ci
      ON ci.id_value = trapper.extract_microchip_from_animal_name(sr.payload->>'Animal Name')
      AND ci.id_type = 'microchip'
    WHERE a.cat_id IS NULL
      AND sr.payload->>'Animal Name' ~ '\d{9,}'
  ),
  linked AS (
    UPDATE trapper.sot_appointments a
    SET cat_id = nl.cat_id,
        cat_linking_status = 'linked_via_embedded_microchip',
        updated_at = NOW()
    FROM newly_linkable nl
    WHERE a.appointment_id = nl.appointment_id
      AND a.cat_id IS NULL
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_linked FROM linked;

  operation := 'additional_appointments_linked';
  count := v_linked;
  RETURN NEXT;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.create_cats_from_embedded_microchips() IS
'Creates cat records from embedded microchips in Animal Name field, then links appointments.
MIG_911: Now uses extract_microchip_from_animal_name() for safe extraction.';

-- ============================================================
-- 4. Update run_all_entity_linking to include embedded chip extraction
-- ============================================================

\echo ''
\echo 'Step 4: Adding embedded chip extraction to entity linking chain...'

-- First check the current function signature
DO $$
DECLARE
  v_current_def TEXT;
BEGIN
  SELECT pg_get_functiondef(oid) INTO v_current_def
  FROM pg_proc
  WHERE proname = 'run_all_entity_linking'
    AND pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'trapper');

  -- If the function doesn't include embedded chip extraction, we need to update it
  IF v_current_def NOT LIKE '%link_appointments_via_embedded_microchips%' THEN
    RAISE NOTICE 'run_all_entity_linking needs to be updated to include embedded chip extraction';
  ELSE
    RAISE NOTICE 'run_all_entity_linking already includes embedded chip extraction';
  END IF;
END;
$$;

-- Add a wrapper function that can be called from entity linking cron
CREATE OR REPLACE FUNCTION trapper.process_embedded_microchips_in_animal_names()
RETURNS TABLE (
  operation TEXT,
  count INT
) AS $$
BEGIN
  -- Step 1: Link appointments to existing cats via embedded microchips
  RETURN QUERY SELECT * FROM trapper.link_appointments_via_embedded_microchips();

  -- Step 2: Create cats for new microchips and link remaining appointments
  RETURN QUERY SELECT * FROM trapper.create_cats_from_embedded_microchips();
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.process_embedded_microchips_in_animal_names() IS
'Wrapper function to process all embedded microchips in Animal Name fields.
Called from entity-linking cron to ensure automatic processing.
Uses safe extraction via detect_microchip_format().';

-- ============================================================
-- 5. Test the safe extraction
-- ============================================================

\echo ''
\echo 'Step 5: Testing safe extraction...'

SELECT
  'Macy - A439019 - 981020039875779' AS animal_name,
  trapper.extract_microchip_from_animal_name('Macy - A439019 - 981020039875779') AS extracted_chip;

SELECT
  'A426581    900085001797139' AS animal_name,
  trapper.extract_microchip_from_animal_name('A426581    900085001797139') AS extracted_chip;

SELECT
  '981020053927285' AS animal_name,
  trapper.extract_microchip_from_animal_name('981020053927285') AS extracted_chip;

-- ============================================================
-- 6. Verification
-- ============================================================

\echo ''
\echo '=== VERIFICATION ==='
\echo ''
\echo 'Functions updated:'
SELECT routine_name FROM information_schema.routines
WHERE routine_schema = 'trapper'
  AND routine_name IN (
    'extract_microchip_from_animal_name',
    'link_appointments_via_embedded_microchips',
    'create_cats_from_embedded_microchips',
    'process_embedded_microchips_in_animal_names'
  )
ORDER BY routine_name;

\echo ''
\echo '=== MIG_911 Complete ==='
\echo ''
\echo 'IMPORTANT: Add to entity-linking cron:'
\echo '  await queryRows("SELECT * FROM trapper.process_embedded_microchips_in_animal_names()");'
