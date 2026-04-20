-- MIG_3099: Waiver-to-appointment matching using ALL OCR signals
--
-- Problem: waiver OCR extracts CDN, chip, sex, weight, description — but
-- only chip was used for matching. When chip is garbled (65% of cases),
-- the waiver CDN can't be bridged to the appointment.
--
-- Solution: for unmatched waivers, use weight + sex + description to find
-- the correct appointment. Weight at 2 decimal places is near-unique per
-- clinic day (1-3 dupes in 30-50 cats).
--
-- This runs BEFORE CDN-first matching to maximize deterministic matches.
--
-- Created: 2026-04-20

\echo '=============================================='
\echo '  MIG_3099: Waiver weight bridge'
\echo '=============================================='

BEGIN;

CREATE OR REPLACE FUNCTION ops.bridge_waivers_by_weight(p_clinic_date DATE)
RETURNS INT AS $$
DECLARE
  v_bridged INT := 0;
  v_waiver RECORD;
  v_best_appt UUID;
  v_best_score NUMERIC;
  v_entry_count INT;
BEGIN
  -- Get entry count for CDN validation (reject impossible CDNs)
  SELECT COUNT(*) INTO v_entry_count
  FROM ops.clinic_day_entries e
  JOIN ops.clinic_days cd ON cd.clinic_day_id = e.clinic_day_id
  WHERE cd.clinic_date = p_clinic_date;

  -- For each waiver with OCR data but no cat match
  FOR v_waiver IN
    SELECT ws.waiver_id, ws.ocr_clinic_number, ws.ocr_microchip,
      ws.ocr_sex, ws.ocr_weight_lbs,
      ws.ocr_extracted_data->>'description' AS description,
      ws.ocr_owner_last_name
    FROM ops.waiver_scans ws
    WHERE ws.parsed_date = p_clinic_date
      AND ws.ocr_clinic_number IS NOT NULL
      AND ws.matched_cat_id IS NULL
      AND ws.ocr_status = 'extracted'
      -- CDN validation: reject impossible values
      AND ws.ocr_clinic_number <= GREATEST(v_entry_count, 60)
      AND ws.ocr_clinic_number > 0
  LOOP
    v_best_appt := NULL;
    v_best_score := 0;

    -- Score each unclaimed appointment
    SELECT sub.appointment_id, sub.score INTO v_best_appt, v_best_score
    FROM (
      SELECT a.appointment_id,
        -- Weight match (0.40 weight — strongest signal)
        CASE WHEN v_waiver.ocr_weight_lbs IS NOT NULL AND cv.weight_lbs IS NOT NULL
          THEN CASE
            WHEN ABS(v_waiver.ocr_weight_lbs - cv.weight_lbs) < 0.1 THEN 0.40
            WHEN ABS(v_waiver.ocr_weight_lbs - cv.weight_lbs) < 0.5 THEN 0.32
            WHEN ABS(v_waiver.ocr_weight_lbs - cv.weight_lbs) < 1.0 THEN 0.16
            ELSE 0
          END
          ELSE 0
        END
        +
        -- Sex match (0.20)
        CASE WHEN v_waiver.ocr_sex IS NOT NULL AND c.sex IS NOT NULL
          AND UPPER(LEFT(v_waiver.ocr_sex, 1)) = UPPER(LEFT(c.sex, 1))
          THEN 0.20 ELSE 0
        END
        +
        -- Color/description match (0.20)
        CASE WHEN v_waiver.description IS NOT NULL AND (c.primary_color IS NOT NULL OR c.color IS NOT NULL)
          AND LOWER(COALESCE(c.primary_color, c.color, '')) != ''
          AND LOWER(v_waiver.description) LIKE '%' || LOWER(COALESCE(c.primary_color, c.color)) || '%'
          THEN 0.20 ELSE 0
        END
        +
        -- Owner name match (0.20)
        CASE WHEN v_waiver.ocr_owner_last_name IS NOT NULL AND a.client_name IS NOT NULL
          AND LOWER(a.client_name) LIKE '%' || LOWER(v_waiver.ocr_owner_last_name) || '%'
          THEN 0.20 ELSE 0
        END
        AS score
      FROM ops.appointments a
      JOIN sot.cats c ON c.cat_id = a.cat_id AND c.merged_into_cat_id IS NULL
      LEFT JOIN LATERAL (
        SELECT cv.weight_lbs FROM ops.cat_vitals cv
        WHERE cv.cat_id = a.cat_id AND cv.weight_lbs IS NOT NULL AND cv.weight_lbs < 50
        ORDER BY cv.recorded_at DESC LIMIT 1
      ) cv ON true
      WHERE a.appointment_date = p_clinic_date
        AND a.merged_into_appointment_id IS NULL
        -- Not already claimed by a waiver
        AND NOT EXISTS (
          SELECT 1 FROM ops.waiver_scans ws2
          WHERE ws2.matched_appointment_id = a.appointment_id
            AND ws2.parsed_date = p_clinic_date
        )
    ) sub(appointment_id, score)
    WHERE score >= 0.50  -- must match on at least weight+sex or weight+color
    ORDER BY score DESC
    LIMIT 1;

    IF v_best_appt IS NOT NULL THEN
      -- Update waiver with match
      UPDATE ops.waiver_scans SET
        matched_appointment_id = v_best_appt,
        matched_cat_id = (SELECT cat_id FROM ops.appointments WHERE appointment_id = v_best_appt),
        match_method = 'ocr_weight_composite',
        match_confidence = v_best_score
      WHERE waiver_id = v_waiver.waiver_id;

      -- Bridge CDN to appointment
      PERFORM ops.set_clinic_day_number(
        v_best_appt,
        v_waiver.ocr_clinic_number,
        'waiver_ocr'::ops.clinic_day_number_source,
        NULL
      );

      v_bridged := v_bridged + 1;
    END IF;
  END LOOP;

  RETURN v_bridged;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION ops.bridge_waivers_by_weight IS
  'Match unmatched waivers to appointments using weight + sex + description + owner name. '
  'Runs before CDN-first matching to maximize deterministic entry matches. '
  'Weight at 2 decimal places is near-unique per clinic day.';

COMMIT;

\echo '✓ MIG_3099 complete'
