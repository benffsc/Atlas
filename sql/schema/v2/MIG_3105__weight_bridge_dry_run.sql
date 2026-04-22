-- MIG_3105: Dry-run variant of waiver weight bridge for CDN candidate system
--
-- Returns candidate (waiver_id, appointment_id, cdn, score) rows WITHOUT writing.
-- Used by the validate-before-commit CDN pipeline (FFS-1321) to propose CDNs
-- that get validated against the ML before being committed.
--
-- The original ops.bridge_waivers_by_weight() is preserved unchanged as
-- defense-in-depth; this function shares its scoring logic but never writes.
--
-- Created: 2026-04-21

\echo 'MIG_3105: bridge_waivers_by_weight_candidates (dry-run)'

BEGIN;

CREATE OR REPLACE FUNCTION ops.bridge_waivers_by_weight_candidates(p_clinic_date DATE)
RETURNS TABLE(
  waiver_id UUID,
  appointment_id UUID,
  cdn INT,
  score NUMERIC
) AS $$
DECLARE
  v_entry_count INT;
BEGIN
  -- Get entry count for CDN validation (reject impossible CDNs)
  SELECT COUNT(*) INTO v_entry_count
  FROM ops.clinic_day_entries e
  JOIN ops.clinic_days cd ON cd.clinic_day_id = e.clinic_day_id
  WHERE cd.clinic_date = p_clinic_date;

  RETURN QUERY
  WITH scored AS (
    SELECT
      ws.waiver_id AS w_id,
      a.appointment_id AS a_id,
      ws.ocr_clinic_number AS cdn_value,
      -- Weight match (0.40 weight — strongest signal)
      CASE WHEN ws.ocr_weight_lbs IS NOT NULL AND cv.weight_lbs IS NOT NULL
        THEN CASE
          WHEN ABS(ws.ocr_weight_lbs - cv.weight_lbs) < 0.1 THEN 0.40
          WHEN ABS(ws.ocr_weight_lbs - cv.weight_lbs) < 0.5 THEN 0.32
          WHEN ABS(ws.ocr_weight_lbs - cv.weight_lbs) < 1.0 THEN 0.16
          ELSE 0
        END
        ELSE 0
      END
      +
      -- Sex match (0.20)
      CASE WHEN ws.ocr_sex IS NOT NULL AND c.sex IS NOT NULL
        AND UPPER(LEFT(ws.ocr_sex, 1)) = UPPER(LEFT(c.sex, 1))
        THEN 0.20 ELSE 0
      END
      +
      -- Color/description match (0.20)
      CASE WHEN ws.ocr_extracted_data->>'description' IS NOT NULL
        AND (c.primary_color IS NOT NULL OR c.color IS NOT NULL)
        AND LOWER(COALESCE(c.primary_color, c.color, '')) != ''
        AND LOWER(ws.ocr_extracted_data->>'description')
            LIKE '%' || LOWER(COALESCE(c.primary_color, c.color)) || '%'
        THEN 0.20 ELSE 0
      END
      +
      -- Owner name match (0.20)
      CASE WHEN ws.ocr_owner_last_name IS NOT NULL AND a.client_name IS NOT NULL
        AND LOWER(a.client_name) LIKE '%' || LOWER(ws.ocr_owner_last_name) || '%'
        THEN 0.20 ELSE 0
      END
      AS total_score
    FROM ops.waiver_scans ws
    CROSS JOIN LATERAL (
      SELECT a2.appointment_id, a2.client_name, a2.cat_id
      FROM ops.appointments a2
      WHERE a2.appointment_date = p_clinic_date
        AND a2.merged_into_appointment_id IS NULL
        -- Not already claimed by a waiver
        AND NOT EXISTS (
          SELECT 1 FROM ops.waiver_scans ws2
          WHERE ws2.matched_appointment_id = a2.appointment_id
            AND ws2.parsed_date = p_clinic_date
        )
    ) a
    JOIN sot.cats c ON c.cat_id = a.cat_id AND c.merged_into_cat_id IS NULL
    LEFT JOIN LATERAL (
      SELECT cv2.weight_lbs FROM ops.cat_vitals cv2
      WHERE cv2.cat_id = a.cat_id AND cv2.weight_lbs IS NOT NULL AND cv2.weight_lbs < 50
      ORDER BY cv2.recorded_at DESC LIMIT 1
    ) cv ON true
    WHERE ws.parsed_date = p_clinic_date
      AND ws.ocr_clinic_number IS NOT NULL
      AND ws.matched_cat_id IS NULL
      AND ws.ocr_status = 'extracted'
      -- CDN validation: reject impossible values
      AND ws.ocr_clinic_number <= GREATEST(v_entry_count, 60)
      AND ws.ocr_clinic_number > 0
  ),
  -- For each waiver, pick only the best-scoring appointment
  ranked AS (
    SELECT s.*,
      ROW_NUMBER() OVER (PARTITION BY s.w_id ORDER BY s.total_score DESC) AS rn
    FROM scored s
    WHERE s.total_score >= 0.50  -- must match on at least weight+sex or weight+color
  )
  SELECT r.w_id, r.a_id, r.cdn_value, r.total_score
  FROM ranked r
  WHERE r.rn = 1;
END;
$$ LANGUAGE plpgsql STABLE;

COMMIT;

\echo 'Done: bridge_waivers_by_weight_candidates (dry-run for CDN candidate system)'
