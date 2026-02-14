-- MIG_564: SCAS-ShelterLuv Microchip Bridge
--
-- Creates a bridge between SCAS county cats (from ClinicHQ) and ShelterLuv
-- records via shared microchip numbers.
--
-- Dependencies: MIG_515 (scas_animal_id), MIG_621 (shelterluv_id)

\echo ''
\echo '========================================================'
\echo 'MIG_564: SCAS-ShelterLuv Microchip Bridge'
\echo '========================================================'
\echo ''

-- ============================================================
-- PART 1: Bridge View
-- ============================================================

\echo 'Creating v_scas_shelterluv_bridge view...'

CREATE OR REPLACE VIEW trapper.v_scas_shelterluv_bridge AS
SELECT
  c.cat_id,
  c.display_name as cat_name,
  scas_ci.id_value as scas_animal_id,
  chip_ci.id_value as microchip,
  sl_ci.id_value as shelterluv_id,
  CASE
    WHEN sl_ci.id_value IS NOT NULL THEN 'bridged'
    WHEN chip_ci.id_value IS NOT NULL THEN 'has_chip_no_sl'
    ELSE 'no_chip'
  END as bridge_status
FROM trapper.cat_identifiers scas_ci
JOIN trapper.sot_cats c ON c.cat_id = scas_ci.cat_id
  AND c.merged_into_cat_id IS NULL
LEFT JOIN trapper.cat_identifiers chip_ci
  ON chip_ci.cat_id = scas_ci.cat_id
  AND chip_ci.id_type = 'microchip'
LEFT JOIN trapper.cat_identifiers sl_ci
  ON sl_ci.cat_id = scas_ci.cat_id
  AND sl_ci.id_type = 'shelterluv_id'
WHERE scas_ci.id_type = 'scas_animal_id';

COMMENT ON VIEW trapper.v_scas_shelterluv_bridge IS
'Shows SCAS county cats and their bridge status to ShelterLuv.
- bridged: Has both SCAS ID and ShelterLuv ID (linked via microchip)
- has_chip_no_sl: Has microchip but no ShelterLuv ID found
- no_chip: No microchip, cannot bridge';

-- ============================================================
-- PART 2: Bridge Summary View
-- ============================================================

\echo 'Creating v_scas_bridge_summary view...'

CREATE OR REPLACE VIEW trapper.v_scas_bridge_summary AS
SELECT
  bridge_status,
  COUNT(*) as count,
  ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER (), 1) as pct
FROM trapper.v_scas_shelterluv_bridge
GROUP BY bridge_status
ORDER BY count DESC;

COMMENT ON VIEW trapper.v_scas_bridge_summary IS
'Summary of SCAS-ShelterLuv bridge status.';

-- ============================================================
-- PART 3: Match SCAS to ShelterLuv Function
-- ============================================================

\echo 'Creating match_scas_to_shelterluv() function...'

CREATE OR REPLACE FUNCTION trapper.match_scas_to_shelterluv(
  p_batch_size INT DEFAULT 100
)
RETURNS TABLE (
  matched INT,
  already_matched INT,
  no_match INT
)
LANGUAGE plpgsql AS $$
DECLARE
  v_matched INT := 0;
  v_already_matched INT := 0;
  v_no_match INT := 0;
  v_rec RECORD;
  v_sl_internal_id TEXT;
BEGIN
  -- Find SCAS cats with microchip but no ShelterLuv ID
  FOR v_rec IN
    SELECT
      scas_ci.cat_id,
      scas_ci.id_value as scas_id,
      chip_ci.id_value as microchip
    FROM trapper.cat_identifiers scas_ci
    JOIN trapper.cat_identifiers chip_ci
      ON chip_ci.cat_id = scas_ci.cat_id
      AND chip_ci.id_type = 'microchip'
    WHERE scas_ci.id_type = 'scas_animal_id'
      AND NOT EXISTS (
        SELECT 1 FROM trapper.cat_identifiers sl
        WHERE sl.cat_id = scas_ci.cat_id
          AND sl.id_type = 'shelterluv_id'
      )
    LIMIT p_batch_size
  LOOP
    -- Check if ShelterLuv has a record with this microchip
    SELECT sr.payload->>'Internal-ID' INTO v_sl_internal_id
    FROM trapper.staged_records sr
    WHERE sr.source_system = 'shelterluv'
      AND sr.source_table = 'animals'
      AND (
        sr.payload->>'Microchip Number' = v_rec.microchip
        OR sr.payload->>'Microchip' = v_rec.microchip
      )
    LIMIT 1;

    IF v_sl_internal_id IS NOT NULL THEN
      -- Add ShelterLuv ID to the cat
      INSERT INTO trapper.cat_identifiers (
        cat_id, id_type, id_value, source_system, source_table
      )
      VALUES (
        v_rec.cat_id,
        'shelterluv_id',
        v_sl_internal_id,
        'matched_via_microchip',
        'scas_bridge'
      )
      ON CONFLICT (id_type, id_value) DO NOTHING;

      IF FOUND THEN
        v_matched := v_matched + 1;
      ELSE
        v_already_matched := v_already_matched + 1;
      END IF;
    ELSE
      v_no_match := v_no_match + 1;
    END IF;
  END LOOP;

  RETURN QUERY SELECT v_matched, v_already_matched, v_no_match;
END;
$$;

COMMENT ON FUNCTION trapper.match_scas_to_shelterluv IS
'Finds SCAS cats that have matching ShelterLuv records via microchip
and adds the ShelterLuv ID as an identifier.

Run periodically to bridge new SCAS cats to ShelterLuv.
Returns: (matched, already_matched, no_match)';

-- ============================================================
-- PART 4: Run Initial Matching
-- ============================================================

\echo ''
\echo 'Running initial SCAS-ShelterLuv matching...'

DO $$
DECLARE
  v_result RECORD;
  v_total_matched INT := 0;
  v_iteration INT := 0;
BEGIN
  LOOP
    v_iteration := v_iteration + 1;

    SELECT * INTO v_result
    FROM trapper.match_scas_to_shelterluv(100);

    v_total_matched := v_total_matched + v_result.matched;

    IF v_result.matched > 0 OR v_result.no_match > 0 THEN
      RAISE NOTICE 'Iteration %: matched=%, no_match=%',
        v_iteration, v_result.matched, v_result.no_match;
    END IF;

    -- Exit when no more to process
    EXIT WHEN v_result.matched = 0 AND v_result.no_match = 0;

    -- Safety limit
    EXIT WHEN v_iteration > 50;
  END LOOP;

  RAISE NOTICE 'SCAS-ShelterLuv matching complete. Total matched: %', v_total_matched;
END $$;

-- ============================================================
-- VERIFICATION
-- ============================================================

\echo ''
\echo 'SCAS-ShelterLuv Bridge Summary:'

SELECT * FROM trapper.v_scas_bridge_summary;

\echo ''
\echo 'Sample bridged cats:'

SELECT * FROM trapper.v_scas_shelterluv_bridge
WHERE bridge_status = 'bridged'
LIMIT 5;

\echo ''
\echo '========================================================'
\echo 'MIG_564 Complete!'
\echo '========================================================'
\echo ''
