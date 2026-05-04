-- MIG_3102: Safe owner name matching — don't randomly assign multi-cat owners
--
-- Problem: match_master_list_by_owner_name Pass 1b matches by owner name alone.
-- For multi-cat owners (Smith has 3 cats on lines 5,6,7), it arbitrarily pairs
-- entries to appointments. CDN = ML line number = unique per cat. A random
-- assignment gives the wrong CDN to the wrong cat ~50% of the time.
--
-- Fix: Pass 1b only matches when the owner has exactly 1 unmatched entry AND
-- 1 unclaimed appointment on that date. Multi-cat owners without cat names
-- stay unmatched until CDN (from waiver) or weight can disambiguate.
--
-- Pass 1a (owner + cat name) is already safe — cat name disambiguates.
--
-- Created: 2026-04-20

\echo '=============================================='
\echo '  MIG_3102: Safe owner name matching'
\echo '=============================================='

BEGIN;

CREATE OR REPLACE FUNCTION ops.match_master_list_by_owner_name(p_clinic_date DATE)
RETURNS INT AS $$
DECLARE
  v_matched INT := 0;
  v_pass1a INT := 0;
  v_pass1b INT := 0;
BEGIN
  -- Pass 1a: Match by owner name AND cat name (safe for multi-cat owners)
  -- Cat name similarity > 0.5 disambiguates which cat is which
  WITH matches AS (
    UPDATE ops.clinic_day_entries e
    SET
      matched_appointment_id = sub.appointment_id,
      match_confidence = 'high',
      match_reason = 'owner_and_cat_name',
      matched_at = NOW()
    FROM (
      SELECT DISTINCT ON (e2.entry_id)
        e2.entry_id,
        a.appointment_id,
        similarity(LOWER(COALESCE(e2.parsed_cat_name, '')), LOWER(COALESCE(c.name, ''))) AS cat_sim
      FROM ops.clinic_day_entries e2
      JOIN ops.clinic_days cd ON cd.clinic_day_id = e2.clinic_day_id
      JOIN ops.appointments a ON a.appointment_date = cd.clinic_date
        AND a.merged_into_appointment_id IS NULL
      JOIN sot.cats c ON c.cat_id = a.cat_id AND c.merged_into_cat_id IS NULL
      LEFT JOIN sot.people owner ON owner.person_id = a.person_id AND owner.merged_into_person_id IS NULL
      LEFT JOIN ops.clinic_accounts ca ON ca.account_id = a.owner_account_id
      WHERE cd.clinic_date = p_clinic_date
        AND e2.matched_appointment_id IS NULL
        AND e2.cancellation_reason IS NULL
        AND e2.parsed_owner_name IS NOT NULL
        AND e2.parsed_cat_name IS NOT NULL
        AND (
          similarity(LOWER(TRIM(e2.parsed_owner_name)), LOWER(TRIM(COALESCE(a.client_name, '')))) > 0.6
          OR LOWER(TRIM(e2.parsed_owner_name)) = LOWER(TRIM(COALESCE(owner.display_name, '')))
          OR LOWER(TRIM(e2.parsed_owner_name)) = LOWER(TRIM(CONCAT(owner.first_name, ' ', owner.last_name)))
          OR LOWER(TRIM(e2.parsed_owner_name)) = LOWER(TRIM(COALESCE(ca.display_name, '')))
        )
        AND similarity(LOWER(e2.parsed_cat_name), LOWER(c.name)) > 0.5
        AND NOT EXISTS (
          SELECT 1 FROM ops.clinic_day_entries e3
          WHERE e3.matched_appointment_id = a.appointment_id
        )
      ORDER BY e2.entry_id, cat_sim DESC
    ) sub
    WHERE e.entry_id = sub.entry_id
    RETURNING e.entry_id
  )
  SELECT COUNT(*) INTO v_pass1a FROM matches;

  -- Pass 1b: Match by owner name ONLY — but ONLY for single-cat owners
  -- If this owner has multiple unmatched entries for this date, skip entirely.
  -- Random assignment of multi-cat entries creates wrong CDN associations.
  WITH single_owner_entries AS (
    -- Find owners with exactly 1 unmatched entry on this date
    SELECT e2.parsed_owner_name
    FROM ops.clinic_day_entries e2
    JOIN ops.clinic_days cd ON cd.clinic_day_id = e2.clinic_day_id
    WHERE cd.clinic_date = p_clinic_date
      AND e2.matched_appointment_id IS NULL
      AND e2.cancellation_reason IS NULL
      AND e2.parsed_owner_name IS NOT NULL
    GROUP BY e2.parsed_owner_name
    HAVING COUNT(*) = 1
  ),
  single_owner_appts AS (
    -- Find owners with exactly 1 unclaimed appointment on this date
    SELECT LOWER(TRIM(a.client_name)) AS norm_name
    FROM ops.appointments a
    WHERE a.appointment_date = p_clinic_date
      AND a.merged_into_appointment_id IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM ops.clinic_day_entries e3
        WHERE e3.matched_appointment_id = a.appointment_id
      )
    GROUP BY LOWER(TRIM(a.client_name))
    HAVING COUNT(*) = 1
  ),
  matches AS (
    UPDATE ops.clinic_day_entries e
    SET
      matched_appointment_id = sub.appointment_id,
      match_confidence = 'high',
      match_reason = 'owner_name_exact',
      matched_at = NOW()
    FROM (
      SELECT DISTINCT ON (e2.entry_id)
        e2.entry_id,
        a.appointment_id
      FROM ops.clinic_day_entries e2
      JOIN ops.clinic_days cd ON cd.clinic_day_id = e2.clinic_day_id
      JOIN single_owner_entries soe ON LOWER(TRIM(soe.parsed_owner_name)) = LOWER(TRIM(e2.parsed_owner_name))
      JOIN ops.appointments a ON a.appointment_date = cd.clinic_date
        AND a.merged_into_appointment_id IS NULL
      JOIN single_owner_appts soa ON soa.norm_name = LOWER(TRIM(a.client_name))
      LEFT JOIN sot.people owner ON owner.person_id = a.person_id AND owner.merged_into_person_id IS NULL
      LEFT JOIN ops.clinic_accounts ca ON ca.account_id = a.owner_account_id
      WHERE cd.clinic_date = p_clinic_date
        AND e2.matched_appointment_id IS NULL
        AND e2.cancellation_reason IS NULL
        AND e2.parsed_owner_name IS NOT NULL
        AND (
          LOWER(TRIM(e2.parsed_owner_name)) = LOWER(TRIM(a.client_name))
          OR LOWER(TRIM(e2.parsed_owner_name)) = LOWER(TRIM(COALESCE(owner.display_name, '')))
          OR LOWER(TRIM(e2.parsed_owner_name)) = LOWER(TRIM(CONCAT(owner.first_name, ' ', owner.last_name)))
          OR LOWER(TRIM(e2.parsed_owner_name)) = LOWER(TRIM(COALESCE(ca.display_name, '')))
        )
        AND NOT EXISTS (
          SELECT 1 FROM ops.clinic_day_entries e3
          WHERE e3.matched_appointment_id = a.appointment_id
        )
      ORDER BY e2.entry_id
    ) sub
    WHERE e.entry_id = sub.entry_id
    RETURNING e.entry_id
  )
  SELECT COUNT(*) INTO v_pass1b FROM matches;

  v_matched := v_pass1a + v_pass1b;
  RETURN v_matched;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION ops.match_master_list_by_owner_name IS
  'Pass 1: Match ML entries by owner name. '
  'Pass 1a: owner + cat name (safe for multi-cat). '
  'Pass 1b: owner name only, but ONLY single-entry owners (MIG_3102). '
  'Multi-cat owners without cat names stay unmatched until CDN/weight disambiguates.';

COMMIT;

\echo ''
\echo '=============================================='
\echo '  MIG_3102 Complete'
\echo '=============================================='
\echo ''
\echo 'Multi-cat owners without cat names now stay unmatched.'
\echo 'They will match when waiver CDN extraction provides CDN-first matching.'
\echo ''
