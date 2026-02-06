-- ============================================================================
-- MIG_908: Extract Embedded Microchips from Animal Name
-- ============================================================================
-- Problem: 4,331 appointments missing cat_id. Investigation shows many have
-- microchips embedded in the Animal Name field:
--   - "Simon 981020027430416"
--   - "Inaba (Nipper) 981020003362905"
--   - "Jackie 982000361929523"
--
-- These are valid microchips but not in the dedicated Microchip Number field.
--
-- Solution:
--   1. Extract microchip numbers from Animal Name using regex
--   2. Link appointments to existing cats via extracted microchips
--   3. For chips not in system, create new cat records (with needs_microchip=false)
--
-- Impact: ~646 appointments can be linked to existing cats
-- ============================================================================

\echo '=== MIG_908: Extract Embedded Microchips from Animal Name ==='
\echo ''

-- ============================================================================
-- Phase 1: Preview linkable appointments
-- ============================================================================

\echo 'Phase 1: Previewing appointments with embedded microchips...'

CREATE OR REPLACE FUNCTION trapper.preview_embedded_microchip_links()
RETURNS TABLE (
  has_embedded_chip BIGINT,
  matches_existing_cat BIGINT,
  chip_not_in_system BIGINT
) AS $$
  WITH extracted_chips AS (
    SELECT
      a.appointment_id,
      (regexp_match(sr.payload->>'Animal Name', '(\d{9,15})'))[1] AS extracted_chip
    FROM trapper.sot_appointments a
    JOIN trapper.staged_records sr ON sr.source_row_id = a.source_record_id
      AND sr.source_system = 'clinichq'
      AND sr.source_table = 'appointment_info'
    WHERE a.cat_id IS NULL
      AND sr.payload->>'Animal Name' ~ '\d{9,15}'
  )
  SELECT
    COUNT(*)::BIGINT AS has_embedded_chip,
    COUNT(ci.cat_id)::BIGINT AS matches_existing_cat,
    (COUNT(*) - COUNT(ci.cat_id))::BIGINT AS chip_not_in_system
  FROM extracted_chips ec
  LEFT JOIN trapper.cat_identifiers ci
    ON ci.id_value = ec.extracted_chip
    AND ci.id_type = 'microchip';
$$ LANGUAGE sql;

SELECT * FROM trapper.preview_embedded_microchip_links();

-- ============================================================================
-- Phase 2: Link appointments via embedded microchips
-- ============================================================================

\echo ''
\echo 'Phase 2: Linking appointments via embedded microchips...'

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
  -- Step 1: Link to existing cats via microchip
  WITH extracted_chips AS (
    SELECT
      a.appointment_id,
      (regexp_match(sr.payload->>'Animal Name', '(\d{9,15})'))[1] AS extracted_chip,
      sr.payload->>'Animal Name' AS animal_name
    FROM trapper.sot_appointments a
    JOIN trapper.staged_records sr ON sr.source_row_id = a.source_record_id
      AND sr.source_system = 'clinichq'
      AND sr.source_table = 'appointment_info'
    WHERE a.cat_id IS NULL
      AND sr.payload->>'Animal Name' ~ '\d{9,15}'
  ),
  linkable AS (
    SELECT ec.appointment_id, ci.cat_id
    FROM extracted_chips ec
    JOIN trapper.cat_identifiers ci
      ON ci.id_value = ec.extracted_chip
      AND ci.id_type = 'microchip'
    JOIN trapper.sot_cats c ON c.cat_id = ci.cat_id
      AND c.merged_into_cat_id IS NULL
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

  -- Step 2: Create cats for microchips not in system (optional)
  -- This handles cases where the chip exists in ClinicHQ but not yet in sot_cats
  WITH new_chips AS (
    SELECT DISTINCT
      ec.extracted_chip,
      ec.animal_name,
      -- Extract cat name by removing the microchip from animal_name
      TRIM(regexp_replace(ec.animal_name, '\d{9,15}', '', 'g')) AS cat_name
    FROM (
      SELECT
        (regexp_match(sr.payload->>'Animal Name', '(\d{9,15})'))[1] AS extracted_chip,
        sr.payload->>'Animal Name' AS animal_name
      FROM trapper.sot_appointments a
      JOIN trapper.staged_records sr ON sr.source_row_id = a.source_record_id
        AND sr.source_system = 'clinichq'
        AND sr.source_table = 'appointment_info'
      WHERE a.cat_id IS NULL
        AND sr.payload->>'Animal Name' ~ '\d{9,15}'
    ) ec
    WHERE NOT EXISTS (
      SELECT 1 FROM trapper.cat_identifiers ci
      WHERE ci.id_value = ec.extracted_chip AND ci.id_type = 'microchip'
    )
    AND ec.extracted_chip IS NOT NULL
    AND LENGTH(ec.extracted_chip) >= 9
  )
  SELECT COUNT(*) INTO v_created FROM new_chips;

  -- For now, just report how many would need creation
  -- Actual cat creation should use find_or_create_cat_by_microchip()
  operation := 'chips_not_in_system_would_need_cats';
  count := v_created;
  RETURN NEXT;
END;
$$ LANGUAGE plpgsql;

-- Run the linking
SELECT * FROM trapper.link_appointments_via_embedded_microchips();

-- ============================================================================
-- Phase 3: Verify results
-- ============================================================================

\echo ''
\echo 'Phase 3: Verifying results...'

SELECT
  'Appointments with cat_id (after)' AS metric,
  COUNT(*)::TEXT AS value
FROM trapper.sot_appointments WHERE cat_id IS NOT NULL
UNION ALL
SELECT
  'Appointments missing cat_id (after)',
  COUNT(*)::TEXT
FROM trapper.sot_appointments WHERE cat_id IS NULL
UNION ALL
SELECT
  'Linked via embedded microchip',
  COUNT(*)::TEXT
FROM trapper.sot_appointments WHERE cat_linking_status = 'linked_via_embedded_microchip';

-- ============================================================================
-- Phase 4: Create cats for microchips not in system
-- ============================================================================

\echo ''
\echo 'Phase 4: Creating cats from embedded microchips not in system...'

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
  -- Create cats for each unique new microchip
  FOR rec IN
    WITH new_chips AS (
      SELECT DISTINCT ON ((regexp_match(sr.payload->>'Animal Name', '(\d{9,15})'))[1])
        (regexp_match(sr.payload->>'Animal Name', '(\d{9,15})'))[1] AS extracted_chip,
        sr.payload->>'Animal Name' AS animal_name,
        TRIM(regexp_replace(
          regexp_replace(sr.payload->>'Animal Name', '\d{9,15}', '', 'g'),
          '[-"'']', '', 'g'
        )) AS cat_name,
        sr.payload->>'Sex' AS sex,
        a.appointment_id
      FROM trapper.sot_appointments a
      JOIN trapper.staged_records sr ON sr.source_row_id = a.source_record_id
        AND sr.source_system = 'clinichq'
        AND sr.source_table = 'appointment_info'
      WHERE a.cat_id IS NULL
        AND sr.payload->>'Animal Name' ~ '\d{9,15}'
        AND NOT EXISTS (
          SELECT 1 FROM trapper.cat_identifiers ci
          WHERE ci.id_value = (regexp_match(sr.payload->>'Animal Name', '(\d{9,15})'))[1]
            AND ci.id_type = 'microchip'
        )
      ORDER BY (regexp_match(sr.payload->>'Animal Name', '(\d{9,15})'))[1], a.appointment_date DESC
    )
    SELECT * FROM new_chips
    WHERE extracted_chip IS NOT NULL
      AND LENGTH(extracted_chip) >= 9
  LOOP
    -- Use find_or_create_cat_by_microchip with correct signature
    SELECT trapper.find_or_create_cat_by_microchip(
      p_microchip := rec.extracted_chip,
      p_name := NULLIF(rec.cat_name, ''),
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
      ON ci.id_value = (regexp_match(sr.payload->>'Animal Name', '(\d{9,15})'))[1]
      AND ci.id_type = 'microchip'
    WHERE a.cat_id IS NULL
      AND sr.payload->>'Animal Name' ~ '\d{9,15}'
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
'Creates cat records from embedded microchips in Animal Name field, then links remaining appointments.';

-- Run cat creation (already run if migration was executed)
-- SELECT * FROM trapper.create_cats_from_embedded_microchips();

\echo ''
\echo '=== MIG_908 Complete ==='
\echo ''
\echo 'Summary: Extracted microchips from Animal Name field and linked appointments.'
\echo 'Run create_cats_from_embedded_microchips() for any remaining unlinked chips.'
