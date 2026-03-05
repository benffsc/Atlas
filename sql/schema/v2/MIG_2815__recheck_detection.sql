-- MIG_2815__recheck_detection.sql
-- FFS-105: Add recheck/medical follow-up detection columns to clinic_day_entries
-- Rechecks are weight checks, post-op follow-ups, etc. that should NOT inflate TNR counts.

ALTER TABLE ops.clinic_day_entries ADD COLUMN IF NOT EXISTS is_recheck BOOLEAN DEFAULT FALSE;
ALTER TABLE ops.clinic_day_entries ADD COLUMN IF NOT EXISTS recheck_type TEXT;

COMMENT ON COLUMN ops.clinic_day_entries.is_recheck IS 'FFS-105: Entry is a recheck/follow-up, not a new TNR procedure';
COMMENT ON COLUMN ops.clinic_day_entries.recheck_type IS 'FFS-105: Type of recheck (recheck, weight_check, dr_follow-up, post-op, etc.)';

-- Update get_master_list_match_stats to exclude rechecks from TNR counts
CREATE OR REPLACE FUNCTION ops.get_master_list_match_stats(p_clinic_date DATE)
RETURNS TABLE (
  total_entries INT,
  matched_high INT,
  matched_medium INT,
  matched_low INT,
  unmatched INT,
  total_appointments INT,
  appointments_matched INT,
  appointments_unmatched INT
) AS $$
BEGIN
  RETURN QUERY
  WITH entry_stats AS (
    SELECT
      COUNT(*)::INT AS total,
      COUNT(*) FILTER (WHERE match_confidence = 'high')::INT AS high,
      COUNT(*) FILTER (WHERE match_confidence = 'medium')::INT AS medium,
      COUNT(*) FILTER (WHERE match_confidence = 'low')::INT AS low,
      COUNT(*) FILTER (WHERE match_confidence IS NULL OR match_confidence = 'unmatched')::INT AS unmatched
    FROM ops.clinic_day_entries e
    JOIN ops.clinic_days cd ON cd.clinic_day_id = e.clinic_day_id
    WHERE cd.clinic_date = p_clinic_date
      AND NOT COALESCE(e.is_recheck, FALSE)
  ),
  appt_stats AS (
    SELECT
      COUNT(*)::INT AS total,
      COUNT(*) FILTER (WHERE EXISTS (
        SELECT 1 FROM ops.clinic_day_entries e
        WHERE e.matched_appointment_id = a.appointment_id
      ))::INT AS matched
    FROM ops.appointments a
    WHERE a.appointment_date = p_clinic_date
  )
  SELECT
    es.total,
    es.high,
    es.medium,
    es.low,
    es.unmatched,
    aps.total,
    aps.matched,
    (aps.total - aps.matched)::INT
  FROM entry_stats es, appt_stats aps;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION ops.get_master_list_match_stats IS 'Get matching statistics for a clinic day (excludes rechecks from TNR counts)';
