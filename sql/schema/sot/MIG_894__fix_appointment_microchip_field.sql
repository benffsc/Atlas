\echo '=== MIG_894: Fix Appointment Microchip Field Name ==='
\echo ''
\echo 'Problem: process_clinichq_appointment_info() references payload->>''Microchip Number'''
\echo 'but appointment_info data uses payload->>''Microchip'' (no "Number" suffix).'
\echo ''
\echo 'This causes microchip-based cat linking to silently fail for appointments.'
\echo ''
\echo 'Solution: Update the function to use the correct field name.'
\echo ''

-- ==============================================================
-- Fix process_clinichq_appointment_info to use correct field name
-- ==============================================================

CREATE OR REPLACE FUNCTION trapper.process_clinichq_appointment_info(
  p_job_id UUID DEFAULT NULL,
  p_batch_size INT DEFAULT 500
)
RETURNS JSONB AS $$
DECLARE
  v_results JSONB := '{}';
  v_count INT;
BEGIN
  -- Step 0: Link orphaned appointments to cats (in case cat_info was processed first)
  -- NOTE: appointment_info uses 'Microchip' not 'Microchip Number'
  WITH updates AS (
    UPDATE trapper.sot_appointments a
    SET cat_id = trapper.get_canonical_cat_id(ci.cat_id)
    FROM trapper.staged_records sr
    JOIN trapper.cat_identifiers ci ON ci.id_value = sr.payload->>'Microchip' AND ci.id_type = 'microchip'
    WHERE a.appointment_number = sr.payload->>'Number'
      AND a.appointment_date = TO_DATE(sr.payload->>'Date', 'MM/DD/YYYY')
      AND sr.source_system = 'clinichq'
      AND sr.source_table = 'appointment_info'
      AND a.cat_id IS NULL
      AND sr.payload->>'Microchip' IS NOT NULL
      AND TRIM(sr.payload->>'Microchip') != ''
    RETURNING a.appointment_id
  )
  SELECT COUNT(*) INTO v_count FROM updates;
  v_results := v_results || jsonb_build_object('orphaned_appointments_linked_pre', v_count);

  -- Step 1: Create sot_appointments from staged_records
  WITH inserts AS (
    INSERT INTO trapper.sot_appointments (
      cat_id, appointment_date, appointment_number, service_type,
      is_spay, is_neuter, vet_name, technician, temperature, medical_notes,
      is_lactating, is_pregnant, is_in_heat,
      data_source, source_system, source_record_id, source_row_hash
    )
    SELECT
      trapper.get_canonical_cat_id(c.cat_id),
      TO_DATE(sr.payload->>'Date', 'MM/DD/YYYY'),
      sr.payload->>'Number',
      COALESCE(sr.payload->>'All Services', sr.payload->>'Service / Subsidy'),
      sr.payload->>'Spay' = 'Yes',
      sr.payload->>'Neuter' = 'Yes',
      sr.payload->>'Vet Name',
      sr.payload->>'Technician',
      CASE WHEN sr.payload->>'Temperature' ~ '^[0-9]+\.?[0-9]*$'
           THEN (sr.payload->>'Temperature')::NUMERIC(4,1)
           ELSE NULL END,
      sr.payload->>'Internal Medical Notes',
      sr.payload->>'Lactating' = 'Yes' OR sr.payload->>'Lactating_2' = 'Yes',
      sr.payload->>'Pregnant' = 'Yes',
      sr.payload->>'In Heat' = 'Yes',
      'clinichq', 'clinichq', sr.source_row_id, sr.row_hash
    FROM trapper.staged_records sr
    -- NOTE: appointment_info uses 'Microchip' not 'Microchip Number'
    LEFT JOIN trapper.cat_identifiers ci ON ci.id_value = sr.payload->>'Microchip' AND ci.id_type = 'microchip'
    LEFT JOIN trapper.sot_cats c ON c.cat_id = ci.cat_id
    WHERE sr.source_system = 'clinichq'
      AND sr.source_table = 'appointment_info'
      AND sr.payload->>'Date' IS NOT NULL AND sr.payload->>'Date' != ''
      AND sr.processed_at IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM trapper.sot_appointments a
        WHERE a.appointment_number = sr.payload->>'Number'
          AND a.appointment_date = TO_DATE(sr.payload->>'Date', 'MM/DD/YYYY')
      )
    ON CONFLICT DO NOTHING
    RETURNING appointment_id
  )
  SELECT COUNT(*) INTO v_count FROM inserts;
  v_results := v_results || jsonb_build_object('appointments_created', v_count);

  -- Step 2: Update existing appointments with missing cat_id
  WITH updates AS (
    UPDATE trapper.sot_appointments a
    SET cat_id = trapper.get_canonical_cat_id(ci.cat_id)
    FROM trapper.staged_records sr
    JOIN trapper.cat_identifiers ci ON ci.id_value = sr.payload->>'Microchip' AND ci.id_type = 'microchip'
    WHERE a.appointment_number = sr.payload->>'Number'
      AND a.appointment_date = TO_DATE(sr.payload->>'Date', 'MM/DD/YYYY')
      AND sr.source_system = 'clinichq'
      AND sr.source_table = 'appointment_info'
      AND a.cat_id IS NULL
      AND sr.payload->>'Microchip' IS NOT NULL
      AND TRIM(sr.payload->>'Microchip') != ''
    RETURNING a.appointment_id
  )
  SELECT COUNT(*) INTO v_count FROM updates;
  v_results := v_results || jsonb_build_object('orphaned_appointments_linked', v_count);

  -- Mark records as processed
  UPDATE trapper.staged_records
  SET processed_at = NOW()
  WHERE source_system = 'clinichq'
    AND source_table = 'appointment_info'
    AND processed_at IS NULL
    AND payload->>'Date' IS NOT NULL
    AND payload->>'Date' != '';

  RETURN v_results;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.process_clinichq_appointment_info IS
'Process ClinicHQ appointment_info staged records.
Creates appointments and links to cats via microchip.
NOTE: appointment_info uses payload->>''Microchip'' (not ''Microchip Number'').';

-- ==============================================================
-- Backfill: Link appointments that have microchip in staged data
-- ==============================================================

\echo ''
\echo 'Running backfill to link appointments via corrected microchip field...'

WITH linked AS (
  UPDATE trapper.sot_appointments a
  SET cat_id = trapper.get_canonical_cat_id(ci.cat_id)
  FROM trapper.staged_records sr
  JOIN trapper.cat_identifiers ci ON ci.id_value = sr.payload->>'Microchip' AND ci.id_type = 'microchip'
  WHERE a.source_record_id = sr.source_row_id
    AND sr.source_system = 'clinichq'
    AND sr.source_table = 'appointment_info'
    AND a.cat_id IS NULL
    AND sr.payload->>'Microchip' IS NOT NULL
    AND TRIM(sr.payload->>'Microchip') != ''
    AND LENGTH(TRIM(sr.payload->>'Microchip')) >= 9
  RETURNING a.appointment_id, ci.id_value AS microchip
)
SELECT
  COUNT(*) AS appointments_linked,
  COUNT(DISTINCT microchip) AS unique_microchips
FROM linked;

\echo ''
\echo 'MIG_894 complete.'
\echo 'appointment_info microchip field name corrected from ''Microchip Number'' to ''Microchip''.'
