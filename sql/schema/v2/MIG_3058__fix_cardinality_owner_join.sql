-- MIG_3058: Restore ops.match_master_list_by_cardinality from drift
--
-- Surfaced during FFS-1088 batch CDS backfill. 5 clinic dates failed with
--   "column a.owner_person_id does not exist"
-- from ops.match_master_list_by_cardinality.
--
-- The committed source in sql/schema/v2/MIG_2330 line 295 reads:
--   LEFT JOIN sot.people owner ON owner.person_id = a.person_id
-- but the live DB version had drifted to:
--   LEFT JOIN sot.people owner ON owner.person_id = a.owner_person_id
-- where owner_person_id does not exist on ops.appointments.
--
-- Someone patched the function in prod without committing a migration.
-- This migration restores the committed version so future deployments
-- don't silently re-break it.
--
-- Only affected 5 of 163 clinic dates because the cardinality pass only
-- fires when there are ≤3 unmatched entries on each side (most dates hit
-- the owner_name pass first and never reach cardinality). The 5 dates
-- happened to have the right residue to trigger this pass.
--
-- Created: 2026-04-08

\echo ''
\echo '=============================================='
\echo '  MIG_3058: Fix match_master_list_by_cardinality drift'
\echo '=============================================='
\echo ''

BEGIN;

CREATE OR REPLACE FUNCTION ops.match_master_list_by_cardinality(p_clinic_date DATE)
RETURNS INT AS $$
DECLARE
  v_matched INT := 0;
  v_clinic_day_id UUID;
  v_unmatched_entries INT;
  v_unmatched_appointments INT;
  r RECORD;
BEGIN
  -- Get clinic_day_id for the date
  SELECT clinic_day_id INTO v_clinic_day_id
  FROM ops.clinic_days
  WHERE clinic_date = p_clinic_date;

  IF v_clinic_day_id IS NULL THEN
    RETURN 0;
  END IF;

  -- Count unmatched on each side
  SELECT COUNT(*) INTO v_unmatched_entries
  FROM ops.clinic_day_entries
  WHERE clinic_day_id = v_clinic_day_id
    AND matched_appointment_id IS NULL;

  SELECT COUNT(*) INTO v_unmatched_appointments
  FROM ops.appointments a
  WHERE a.appointment_date = p_clinic_date
    AND NOT EXISTS (
      SELECT 1 FROM ops.clinic_day_entries e
      WHERE e.matched_appointment_id = a.appointment_id
    );

  -- Only proceed if both sides have ≤3 unmatched
  IF v_unmatched_entries > 3 OR v_unmatched_appointments > 3 THEN
    RETURN 0;
  END IF;

  -- FFS-100: Greedy match with sex/name disambiguation (not just line order)
  -- FIXED 2026-04-08: join owner via a.person_id, not a.owner_person_id
  FOR r IN (
    SELECT DISTINCT ON (e.entry_id)
      e.entry_id,
      a.appointment_id,
      COALESCE(
        similarity(LOWER(COALESCE(e.parsed_cat_name, '')), LOWER(COALESCE(c.name, ''))),
        0
      ) +
      COALESCE(
        similarity(LOWER(COALESCE(e.parsed_owner_name, '')), LOWER(COALESCE(owner.display_name, ''))),
        0
      ) +
      CASE
        WHEN e.female_count > 0 AND e.male_count = 0 AND c.sex = 'Female' THEN 0.5
        WHEN e.male_count > 0 AND e.female_count = 0 AND c.sex = 'Male' THEN 0.5
        ELSE 0
      END AS combined_score
    FROM ops.clinic_day_entries e
    JOIN ops.appointments a ON a.appointment_date = p_clinic_date
    LEFT JOIN sot.cats c ON c.cat_id = a.cat_id
    LEFT JOIN sot.people owner ON owner.person_id = a.person_id
    WHERE e.clinic_day_id = v_clinic_day_id
      AND e.matched_appointment_id IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM ops.clinic_day_entries e2
        WHERE e2.matched_appointment_id = a.appointment_id
      )
    ORDER BY e.entry_id, combined_score DESC
  )
  LOOP
    UPDATE ops.clinic_day_entries
    SET
      matched_appointment_id = r.appointment_id,
      match_confidence = 'low',
      match_reason = 'cardinality_greedy',
      matched_at = NOW()
    WHERE entry_id = r.entry_id
      AND matched_appointment_id IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM ops.clinic_day_entries e2
        WHERE e2.matched_appointment_id = r.appointment_id
      );

    IF FOUND THEN
      v_matched := v_matched + 1;
    END IF;
  END LOOP;

  RETURN v_matched;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION ops.match_master_list_by_cardinality IS
'Pass 4: Greedy best-fit when ≤3 unmatched on each side. MIG_3058 restored
from prod drift that broke the owner join.';

COMMIT;

\echo ''
\echo 'MIG_3058 complete. Re-run CDS on the 5 previously-failed dates:'
\echo '  2025-01-23, 2025-03-06, 2025-04-24, 2025-05-08, 2025-11-20'
\echo ''
