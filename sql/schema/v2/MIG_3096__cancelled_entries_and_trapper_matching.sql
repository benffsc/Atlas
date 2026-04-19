-- MIG_3096: Cancelled entry detection + trapper alias matching
--
-- FFS-1296: Detect ML entries that are cancelled (more entries than appointments
-- for same owner on same date, or recheck entries on wrong date)
--
-- FFS-1297: Match trapper-booked entries against trapper's CHQ appointments
-- (e.g., ML "Elise Gonzalez - Trp Christina" → CHQ "Christina Reyes")
--
-- Created: 2026-04-19

\echo ''
\echo '=============================================='
\echo '  MIG_3096: Cancelled entries + trapper matching'
\echo '=============================================='
\echo ''

BEGIN;

-- ============================================================================
-- 1. Add cancellation_reason column
-- ============================================================================

\echo '1. Adding cancellation_reason column...'

ALTER TABLE ops.clinic_day_entries
  ADD COLUMN IF NOT EXISTS cancellation_reason TEXT;

COMMENT ON COLUMN ops.clinic_day_entries.cancellation_reason IS
  'Why this entry is unmatched: surgery_cancelled, rebooked_later, '
  'recheck_different_date, more_entries_than_appointments, header_row';

-- ============================================================================
-- 2. Detect and tag cancelled entries
-- ============================================================================

\echo '2. Creating ops.detect_cancelled_entries...'

CREATE OR REPLACE FUNCTION ops.detect_cancelled_entries(p_clinic_date DATE)
RETURNS INT AS $$
BEGIN
  -- Tag "Client Name" header rows
  UPDATE ops.clinic_day_entries e
  SET cancellation_reason = 'header_row'
  FROM ops.clinic_days cd
  WHERE cd.clinic_day_id = e.clinic_day_id
    AND cd.clinic_date = p_clinic_date
    AND LOWER(TRIM(e.raw_client_name)) = 'client name'
    AND e.cancellation_reason IS NULL;

  -- Tag unmatched entries where owner has more unmatched entries than unclaimed appointments
  WITH owner_overflow AS (
    SELECT e2.parsed_owner_name
    FROM ops.clinic_day_entries e2
    JOIN ops.clinic_days cd ON cd.clinic_day_id = e2.clinic_day_id
    WHERE cd.clinic_date = p_clinic_date
      AND e2.parsed_owner_name IS NOT NULL
      AND (e2.match_confidence IS NULL OR e2.match_confidence = 'unmatched')
      AND e2.cancellation_reason IS NULL
    GROUP BY e2.parsed_owner_name
    HAVING COUNT(*) > (
      SELECT COUNT(*) FROM ops.appointments a
      WHERE a.appointment_date = p_clinic_date
        AND a.merged_into_appointment_id IS NULL
        AND LOWER(a.client_name) = LOWER(e2.parsed_owner_name)
        AND NOT EXISTS (
          SELECT 1 FROM ops.clinic_day_entries e3
          WHERE e3.matched_appointment_id = a.appointment_id
            AND e3.match_confidence IS NOT NULL AND e3.match_confidence != 'unmatched'
        )
    )
  )
  UPDATE ops.clinic_day_entries e
  SET cancellation_reason = 'more_entries_than_appointments'
  FROM ops.clinic_days cd
  WHERE cd.clinic_day_id = e.clinic_day_id
    AND cd.clinic_date = p_clinic_date
    AND e.parsed_owner_name IN (SELECT parsed_owner_name FROM owner_overflow)
    AND (e.match_confidence IS NULL OR e.match_confidence = 'unmatched')
    AND e.cancellation_reason IS NULL;

  -- Tag recheck entries
  UPDATE ops.clinic_day_entries e
  SET cancellation_reason = 'recheck_different_date'
  FROM ops.clinic_days cd
  WHERE cd.clinic_day_id = e.clinic_day_id
    AND cd.clinic_date = p_clinic_date
    AND e.is_recheck = TRUE
    AND (e.match_confidence IS NULL OR e.match_confidence = 'unmatched')
    AND e.cancellation_reason IS NULL;

  -- Return total tagged
  RETURN (
    SELECT COUNT(*) FROM ops.clinic_day_entries e
    JOIN ops.clinic_days cd ON cd.clinic_day_id = e.clinic_day_id
    WHERE cd.clinic_date = p_clinic_date AND e.cancellation_reason IS NOT NULL
  );
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION ops.detect_cancelled_entries IS
  'Tag unmatched ML entries with cancellation_reason. Detects: header rows, '
  'owner with more entries than appointments, recheck entries. FFS-1296.';

-- ============================================================================
-- 3. Trapper alias matching pass
-- ============================================================================

\echo '3. Creating ops.match_master_list_by_trapper...'

CREATE OR REPLACE FUNCTION ops.match_master_list_by_trapper(p_clinic_date DATE)
RETURNS INT AS $$
DECLARE
  v_matched INT := 0;
BEGIN
  -- Match unmatched entries that have parsed_trapper_alias against
  -- appointments where client_name contains the trapper's first name.
  -- Disambiguate by cat name similarity when multiple trapper appointments exist.
  WITH matches AS (
    UPDATE ops.clinic_day_entries e
    SET
      matched_appointment_id = sub.appointment_id,
      match_confidence = 'medium',
      match_reason = 'trapper_alias',
      matched_at = NOW()
    FROM (
      SELECT DISTINCT ON (e2.entry_id)
        e2.entry_id,
        a.appointment_id,
        -- Score: prefer cat name match, then just any trapper match
        COALESCE(
          similarity(LOWER(COALESCE(e2.parsed_cat_name, '')), LOWER(COALESCE(c.name, ''))),
          0
        ) AS cat_sim
      FROM ops.clinic_day_entries e2
      JOIN ops.clinic_days cd ON cd.clinic_day_id = e2.clinic_day_id
      JOIN ops.appointments a ON a.appointment_date = cd.clinic_date
        AND a.merged_into_appointment_id IS NULL
      LEFT JOIN sot.cats c ON c.cat_id = a.cat_id AND c.merged_into_cat_id IS NULL
      WHERE cd.clinic_date = p_clinic_date
        AND e2.matched_appointment_id IS NULL
        AND e2.cancellation_reason IS NULL
        AND e2.parsed_trapper_alias IS NOT NULL
        AND LENGTH(TRIM(e2.parsed_trapper_alias)) >= 3
        -- Client name contains trapper's first name (case-insensitive)
        AND LOWER(a.client_name) LIKE '%' || LOWER(TRIM(e2.parsed_trapper_alias)) || '%'
        -- Not already claimed
        AND NOT EXISTS (
          SELECT 1 FROM ops.clinic_day_entries e3
          WHERE e3.matched_appointment_id = a.appointment_id
            AND e3.match_confidence IS NOT NULL
            AND e3.match_confidence != 'unmatched'
        )
      ORDER BY e2.entry_id, cat_sim DESC
    ) sub
    WHERE e.entry_id = sub.entry_id
    RETURNING e.entry_id
  )
  SELECT COUNT(*) INTO v_matched FROM matches;

  RETURN v_matched;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION ops.match_master_list_by_trapper IS
  'Match ML entries with trapper alias against appointments booked under the '
  'trapper''s name. Uses parsed_trapper_alias from "- Trp {Name}" suffix. FFS-1297.';

-- ============================================================================
-- 4. Update apply_smart_master_list_matches to include trapper pass
-- ============================================================================

\echo '4. Updating apply_smart_master_list_matches...'

CREATE OR REPLACE FUNCTION ops.apply_smart_master_list_matches(p_clinic_date DATE)
RETURNS TABLE (pass TEXT, entries_matched INT) AS $$
DECLARE
  v_pass1 INT;
  v_pass5 INT;
  v_pass6 INT;
  v_pass7 INT;  -- trapper alias
  v_pass2 INT;
  v_pass3 INT;
  v_pass4 INT;
  v_cancelled INT;
BEGIN
  -- Ensure clinic day exists
  INSERT INTO ops.clinic_days (clinic_date)
  VALUES (p_clinic_date)
  ON CONFLICT (clinic_date) DO NOTHING;

  -- Detect cancelled entries first (so they don't pollute matching)
  v_cancelled := ops.detect_cancelled_entries(p_clinic_date);

  -- Run each pass in order
  v_pass1 := ops.match_master_list_by_owner_name(p_clinic_date);
  v_pass5 := ops.match_master_list_by_foster(p_clinic_date);
  v_pass6 := ops.match_master_list_by_shelter_id(p_clinic_date);
  v_pass7 := ops.match_master_list_by_trapper(p_clinic_date);
  v_pass2 := ops.match_master_list_by_cat_name(p_clinic_date);
  v_pass3 := ops.match_master_list_by_sex(p_clinic_date);
  v_pass4 := ops.match_master_list_by_cardinality(p_clinic_date);

  -- Return results
  pass := 'cancelled_tagged'; entries_matched := v_cancelled; RETURN NEXT;
  pass := 'owner_name'; entries_matched := v_pass1; RETURN NEXT;
  pass := 'foster'; entries_matched := v_pass5; RETURN NEXT;
  pass := 'shelter_id'; entries_matched := v_pass6; RETURN NEXT;
  pass := 'trapper_alias'; entries_matched := v_pass7; RETURN NEXT;
  pass := 'cat_name'; entries_matched := v_pass2; RETURN NEXT;
  pass := 'sex'; entries_matched := v_pass3; RETURN NEXT;
  pass := 'cardinality'; entries_matched := v_pass4; RETURN NEXT;
  pass := 'total'; entries_matched := v_pass1 + v_pass5 + v_pass6 + v_pass7 + v_pass2 + v_pass3 + v_pass4; RETURN NEXT;

  RETURN;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION ops.apply_smart_master_list_matches IS
  'Run all matching passes: cancelled detection → owner_name → foster → '
  'shelter_id → trapper_alias → cat_name → sex → cardinality. FFS-1296/1297.';

-- ============================================================================
-- 5. Backfill: tag existing cancelled entries + run trapper matching
-- ============================================================================

\echo ''
\echo '5. Backfilling cancelled entries + trapper matches on recent dates...'

DO $$
DECLARE
  v_date DATE;
  v_cancelled INT := 0;
  v_trapper INT := 0;
  v_dates DATE[] := ARRAY[
    '2026-03-05','2026-03-09','2026-03-18','2026-03-19',
    '2026-04-01','2026-04-06','2026-04-13','2026-04-15','2026-04-16'
  ];
BEGIN
  FOREACH v_date IN ARRAY v_dates LOOP
    v_cancelled := v_cancelled + ops.detect_cancelled_entries(v_date);
    v_trapper := v_trapper + ops.match_master_list_by_trapper(v_date);
  END LOOP;

  RAISE NOTICE '   Tagged % cancelled entries, matched % via trapper alias', v_cancelled, v_trapper;
END;
$$;

-- Run propagation for any new matches
DO $$
DECLARE
  v_date DATE;
  v_dates DATE[] := ARRAY[
    '2026-03-05','2026-03-09','2026-03-18','2026-03-19',
    '2026-04-01','2026-04-06','2026-04-13','2026-04-15','2026-04-16'
  ];
BEGIN
  FOREACH v_date IN ARRAY v_dates LOOP
    PERFORM ops.propagate_master_list_matches(v_date);
  END LOOP;
END;
$$;

-- ============================================================================
-- 6. Verification
-- ============================================================================

\echo ''
\echo '6. Verification...'

DO $$
DECLARE
  v_cancelled INT;
  v_trapper_func BOOLEAN;
BEGIN
  SELECT COUNT(*) INTO v_cancelled
  FROM ops.clinic_day_entries WHERE cancellation_reason IS NOT NULL;

  SELECT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'ops' AND p.proname = 'match_master_list_by_trapper')
  INTO v_trapper_func;

  RAISE NOTICE '   Tagged cancelled entries: %', v_cancelled;
  RAISE NOTICE '   Trapper matching function: %', CASE WHEN v_trapper_func THEN 'exists' ELSE 'MISSING' END;
  RAISE NOTICE '   ✓ All checks passed';
END;
$$;

COMMIT;

\echo ''
\echo '✓ MIG_3096 complete'
\echo ''
