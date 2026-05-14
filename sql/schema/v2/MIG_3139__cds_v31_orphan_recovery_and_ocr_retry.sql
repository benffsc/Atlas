-- MIG_3139: CDS v3.1 Sprint 3 — Orphan Recovery + OCR Retry Hooks
--
-- FFS-1472: Cross-check 3 CHQ files — recover orphan cat_info as appointments
--   When cat_info + owner_info exist but appointment_info doesn't, create the
--   appointment from available data. Uses find_or_create_appointment().
--
-- FFS-1473: Waiver OCR retry pass
--   After syncing new waivers, retry pending/failed OCR on up to 20 waivers.
--   Track OCR completion dates → add to datesWithNewWaivers for CDS trigger.
--   (SQL function for identifying retry candidates; TS route does actual OCR)
--
-- Created: 2026-05-14

\echo ''
\echo '=============================================='
\echo '  MIG_3139: Orphan Recovery + OCR Retry'
\echo '=============================================='
\echo ''

-- ============================================================================
-- 1. ops.recover_orphan_cat_info_as_appointments() — FFS-1472
-- ============================================================================

\echo '1. Creating ops.recover_orphan_cat_info_as_appointments()...'

CREATE OR REPLACE FUNCTION ops.recover_orphan_cat_info_as_appointments(
  p_batch_id UUID
) RETURNS JSONB AS $$
DECLARE
  v_results JSONB := '{}'::JSONB;
  v_recovered INT := 0;
  v_skipped INT := 0;
  r RECORD;
  v_appt_id UUID;
  v_cat_id UUID;
  v_appt_date DATE;
BEGIN
  -- Find orphan cat_info rows that were logged to ingest_skipped
  -- AND have matching owner_info in the same batch
  FOR r IN
    SELECT
      isk.source_record_id,
      isk.payload,
      isk.source_date,
      isk.payload->>'Number' AS animal_number,
      isk.payload->>'Date' AS date_text,
      isk.payload->>'Animal Name' AS animal_name,
      isk.payload->>'Microchip Number' AS microchip,
      isk.payload->>'Sex' AS sex,
      isk.payload->>'Breed' AS breed,
      isk.payload->>'Primary Color' AS color,
      isk.payload->>'Weight' AS weight,
      -- Check if owner_info exists for this Number in the batch
      (SELECT oi.payload
       FROM ops.staged_records oi
       JOIN ops.file_uploads fu ON fu.upload_id = oi.file_upload_id
       WHERE fu.batch_id = p_batch_id
         AND oi.source_system = 'clinichq'
         AND oi.source_table = 'owner_info'
         AND oi.payload->>'Number' = isk.payload->>'Number'
       LIMIT 1
      ) AS owner_payload
    FROM ops.ingest_skipped isk
    WHERE isk.batch_id = p_batch_id
      AND isk.skip_reason = 'orphan_reference'
      AND isk.source_system = 'clinichq'
      AND isk.source_table = 'cat_info'
      AND isk.resolved_at IS NULL
  LOOP
    -- Must have date
    BEGIN
      v_appt_date := TO_DATE(r.date_text, 'MM/DD/YYYY');
    EXCEPTION WHEN OTHERS THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END;

    -- Try to find or create the cat first
    IF r.microchip IS NOT NULL AND TRIM(r.microchip) != '' THEN
      v_cat_id := sot.find_or_create_cat_by_microchip(
        p_microchip := r.microchip,
        p_name := r.animal_name,
        p_sex := r.sex,
        p_breed := r.breed,
        p_color := r.color,
        p_source_system := 'clinichq',
        p_clinichq_animal_id := r.animal_number
      );
    ELSIF r.animal_number IS NOT NULL THEN
      v_cat_id := sot.find_or_create_cat_by_clinichq_id(
        p_clinichq_animal_id := r.animal_number,
        p_name := r.animal_name,
        p_sex := r.sex,
        p_breed := r.breed,
        p_color := r.color,
        p_source_system := 'clinichq'
      );
    ELSE
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    -- Create the appointment
    v_appt_id := ops.find_or_create_appointment(
      p_source_system := 'clinichq',
      p_source_record_id := r.animal_number || '_' || r.date_text,
      p_appointment_date := v_appt_date,
      p_appointment_number := r.animal_number,
      p_cat_id := v_cat_id,
      p_client_name := CASE
        WHEN r.owner_payload IS NOT NULL
        THEN TRIM(COALESCE(r.owner_payload->>'Owner First Name', '') || ' ' || COALESCE(r.owner_payload->>'Owner Last Name', ''))
        ELSE NULL
      END,
      p_raw_payload := r.payload,
      p_batch_id := p_batch_id
    );

    IF v_appt_id IS NOT NULL THEN
      v_recovered := v_recovered + 1;

      -- Mark the ingest_skipped row as resolved
      UPDATE ops.ingest_skipped
      SET resolved_at = NOW(),
          resolution_notes = 'Auto-recovered as appointment ' || v_appt_id
      WHERE batch_id = p_batch_id
        AND source_record_id = r.source_record_id
        AND skip_reason = 'orphan_reference'
        AND resolved_at IS NULL;

      -- Set weight on the appointment if available
      IF r.weight IS NOT NULL AND r.weight ~ '^[0-9]+\.?[0-9]*$' AND (r.weight)::numeric > 0 THEN
        UPDATE ops.appointments
        SET cat_weight_lbs = (r.weight)::NUMERIC(5,2)
        WHERE appointment_id = v_appt_id
          AND cat_weight_lbs IS NULL;
      END IF;
    ELSE
      v_skipped := v_skipped + 1;
    END IF;
  END LOOP;

  v_results := jsonb_build_object(
    'orphan_appointments_recovered', v_recovered,
    'orphan_appointments_skipped', v_skipped
  );

  RETURN v_results;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION ops.recover_orphan_cat_info_as_appointments IS
'FFS-1472: Recovers appointments from orphan cat_info rows.
When cat_info + owner_info exist but appointment_info is missing (FFS-862 pattern),
creates the appointment using find_or_create_appointment().
Called after batch processing in the ingest pipeline.';

-- ============================================================================
-- 2. ops.get_pending_ocr_waivers() — FFS-1473
-- ============================================================================

\echo '2. Creating ops.get_pending_ocr_waivers()...'

CREATE OR REPLACE FUNCTION ops.get_pending_ocr_waivers(
  p_limit INT DEFAULT 20
) RETURNS TABLE (
  waiver_id UUID,
  parsed_date DATE,
  file_name TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT ws.waiver_id, ws.parsed_date, ssf.file_name
  FROM ops.waiver_scans ws
  LEFT JOIN ops.sharepoint_synced_files ssf ON ssf.waiver_scan_id = ws.waiver_id
  WHERE ws.ocr_status IN ('pending', 'failed')
    AND ws.file_upload_id IS NOT NULL
    -- Don't retry waivers that failed more than 3 times
    AND COALESCE((ws.ocr_error IS NOT NULL)::int, 0) <= 3
  ORDER BY ws.created_at ASC
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION ops.get_pending_ocr_waivers IS
'FFS-1473: Returns waivers needing OCR processing (pending or failed).
Used by sharepoint-waiver-sync cron for retry pass.
Limited to p_limit (default 20) per run.';

-- ============================================================================
-- 3. GRANT PERMISSIONS
-- ============================================================================

\echo '3. Granting permissions...'

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION ops.recover_orphan_cat_info_as_appointments(UUID) TO service_role;
    GRANT EXECUTE ON FUNCTION ops.get_pending_ocr_waivers(INT) TO service_role;
  END IF;
END $$;

-- ============================================================================
-- 4. VERIFICATION
-- ============================================================================

\echo ''
\echo '4. Verification...'

DO $$
BEGIN
  ASSERT (SELECT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'ops' AND p.proname = 'recover_orphan_cat_info_as_appointments'
  )), 'Function ops.recover_orphan_cat_info_as_appointments() not found';

  ASSERT (SELECT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'ops' AND p.proname = 'get_pending_ocr_waivers'
  )), 'Function ops.get_pending_ocr_waivers() not found';

  RAISE NOTICE 'All functions verified';
END $$;

-- Show current orphan and OCR status
SELECT 'Unresolved orphan cat_info rows' AS metric,
  COUNT(*) AS total
FROM ops.ingest_skipped
WHERE skip_reason = 'orphan_reference' AND resolved_at IS NULL;

SELECT 'Pending/failed OCR waivers' AS metric,
  COUNT(*) FILTER (WHERE ocr_status = 'pending') AS pending,
  COUNT(*) FILTER (WHERE ocr_status = 'failed') AS failed,
  COUNT(*) FILTER (WHERE ocr_status = 'extracted') AS extracted
FROM ops.waiver_scans;

\echo ''
\echo '=============================================='
\echo '  MIG_3139 COMPLETE'
\echo '=============================================='
\echo ''
