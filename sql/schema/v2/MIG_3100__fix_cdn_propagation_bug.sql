-- MIG_3100: Fix CDN propagation bug (FFS-1319)
--
-- ROOT CAUSE: propagate_master_list_matches() blindly copies entry.line_number
-- to appointment.clinic_day_number for ALL matched entries. When entries were
-- matched by NAME (which is wrong ~5-10% for multi-cat owners), this creates
-- "phantom CDNs" that CDN-first matching then trusts on subsequent runs,
-- causing cascading wrong matches.
--
-- Example: 04-06 line #2 is Jadis (cancelled). Name matching assigns a Togneri
-- cat to line #2. Propagation sets CDN=2 on the Togneri appointment. Next run,
-- CDN-first sees CDN=2 → matches line 2 → Togneri. Jadis's line is permanently
-- stolen.
--
-- FIX: Remove CDN propagation entirely from this function. CDNs should ONLY be
-- set by authoritative sources:
--   1. waiver_ocr (via ops.set_clinic_day_number)
--   2. manual (staff via admin UI)
--   3. CDN-first matching (already requires CDN to exist on appointment)
--
-- ALSO: Wire match_master_list_by_clinic_day_number into apply_smart_master_list_matches
-- as the FIRST matching pass (before owner_name).
--
-- Created: 2026-04-20

\echo '=============================================='
\echo '  MIG_3100: Fix CDN propagation bug (FFS-1319)'
\echo '=============================================='

BEGIN;

-- ============================================================================
-- 0. Create match_master_list_by_clinic_day_number (CDN-first matching)
-- ============================================================================
-- This function was created via psql in the session but never committed to a
-- migration file. It matches entries deterministically by line_number =
-- appointment.clinic_day_number. ~75% of entries match this way.

\echo '0. Creating match_master_list_by_clinic_day_number...'

CREATE OR REPLACE FUNCTION ops.match_master_list_by_clinic_day_number(p_clinic_date DATE)
RETURNS INT AS $$
DECLARE
  v_matched INT := 0;
BEGIN
  -- Match entries where entry.line_number = appointment.clinic_day_number
  -- This is deterministic: CDN = ML line number (same thing).
  -- Only matches appointments that already have a CDN set by an authoritative
  -- source (waiver_ocr, manual, clinichq_ingest).
  WITH cdn_matches AS (
    UPDATE ops.clinic_day_entries e
    SET matched_appointment_id = a.appointment_id,
        match_confidence = 'high',
        cds_method = 'clinic_day_number'
    FROM ops.appointments a
    JOIN ops.clinic_days cd ON cd.clinic_date = a.appointment_date
    WHERE cd.clinic_day_id = e.clinic_day_id
      AND cd.clinic_date = p_clinic_date
      AND e.line_number = a.clinic_day_number
      AND a.appointment_date = p_clinic_date
      AND a.merged_into_appointment_id IS NULL
      AND a.clinic_day_number IS NOT NULL
      -- Only use authoritative CDN sources (never master_list which could be phantom)
      AND a.clinic_day_number_source IN ('waiver_ocr', 'manual', 'clinichq_ingest', 'cds_propagation', 'legacy_v1')
      -- Don't overwrite existing matches
      AND e.matched_appointment_id IS NULL
      AND (e.match_confidence IS NULL OR e.match_confidence = 'unmatched')
      -- Skip cancelled entries
      AND e.cancellation_reason IS NULL
    RETURNING e.entry_id
  )
  SELECT COUNT(*) INTO v_matched FROM cdn_matches;

  RETURN v_matched;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION ops.match_master_list_by_clinic_day_number IS
  'CDN-first matching: entry.line_number = appointment.clinic_day_number. '
  'Deterministic, ~75% match rate. Only trusts authoritative CDN sources '
  '(waiver_ocr, manual, clinichq_ingest). FFS-1319.';

\echo '   ✓ CDN-first matching function created'

-- ============================================================================
-- 1. Fix propagate_master_list_matches() — REMOVE CDN propagation
-- ============================================================================

\echo '1. Fixing propagate_master_list_matches() — removing CDN propagation...'

-- No-arg overload (global)
CREATE OR REPLACE FUNCTION ops.propagate_master_list_matches()
RETURNS TABLE(appointments_updated INT, cats_linked INT, numbers_propagated INT)
LANGUAGE plpgsql AS $$
DECLARE
  v_appointments_updated INT := 0;
  v_cats_linked INT := 0;
  v_numbers_propagated INT := 0;
BEGIN
  -- Propagate cat_id from appointments to entries that matched
  UPDATE ops.clinic_day_entries e
  SET cat_id = a.cat_id
  FROM ops.appointments a
  WHERE e.appointment_id = a.appointment_id
    AND e.cat_id IS NULL
    AND a.cat_id IS NOT NULL
    AND a.merged_into_appointment_id IS NULL;
  GET DIAGNOSTICS v_cats_linked = ROW_COUNT;

  -- FFS-1319: CDN propagation REMOVED.
  -- NEVER set appointment.clinic_day_number from entry.line_number.
  -- CDN should only flow: waiver/manual → appointment → CDN-first match.
  -- Setting CDN from name-matched entries creates phantom CDNs.
  v_numbers_propagated := 0;

  RETURN QUERY SELECT v_appointments_updated, v_cats_linked, v_numbers_propagated;
END;
$$;

-- Date-scoped overload
CREATE OR REPLACE FUNCTION ops.propagate_master_list_matches(p_date DATE)
RETURNS TABLE(propagated INT, cat_ids_linked INT) AS $$
DECLARE
    v_propagated INT;
    v_cat_ids INT;
BEGIN
    -- Propagate matched_appointment_id → appointment_id for confirmed matches
    WITH propagated AS (
        UPDATE ops.clinic_day_entries e
        SET appointment_id = e.matched_appointment_id
        FROM ops.clinic_days cd
        WHERE cd.clinic_day_id = e.clinic_day_id
          AND cd.clinic_date = p_date
          AND e.matched_appointment_id IS NOT NULL
          AND e.appointment_id IS NULL
          AND e.match_confidence IN ('high', 'medium')
        RETURNING e.entry_id
    )
    SELECT COUNT(*) INTO v_propagated FROM propagated;

    -- Propagate cat_id from appointments to matched entries
    WITH cat_linked AS (
        UPDATE ops.clinic_day_entries e
        SET cat_id = a.cat_id
        FROM ops.appointments a
        WHERE a.appointment_id = e.appointment_id
          AND e.appointment_id IS NOT NULL
          AND e.cat_id IS NULL
          AND a.cat_id IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM ops.clinic_days cd
            WHERE cd.clinic_day_id = e.clinic_day_id AND cd.clinic_date = p_date
          )
        RETURNING e.entry_id
    )
    SELECT COUNT(*) INTO v_cat_ids FROM cat_linked;

    -- FFS-1319: CDN propagation REMOVED.
    -- NEVER set appointment.clinic_day_number from entry.line_number here.
    -- Only authoritative sources (waiver_ocr, manual) should set CDN.
    -- CDN-first matching already requires CDN to exist on the appointment.

    RETURN QUERY SELECT v_propagated, v_cat_ids;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION ops.propagate_master_list_matches() IS
  'Propagate cat_id from appointments to matched entries. '
  'FFS-1319: CDN propagation REMOVED — never set clinic_day_number from entry.line_number. '
  'CDN should only come from: waiver_ocr, manual, or CDN-first (which already has it).';

COMMENT ON FUNCTION ops.propagate_master_list_matches(DATE) IS
  'Propagate matched_appointment_id → appointment_id and cat_id for a specific date. '
  'FFS-1319: CDN propagation REMOVED — prevents phantom CDN creation from name-matched entries.';

\echo '   ✓ CDN propagation removed from both overloads'

-- ============================================================================
-- 2. Wire CDN-first matching into apply_smart_master_list_matches
-- ============================================================================

\echo ''
\echo '2. Adding CDN-first pass to apply_smart_master_list_matches...'

CREATE OR REPLACE FUNCTION ops.apply_smart_master_list_matches(p_clinic_date DATE)
RETURNS TABLE (pass TEXT, entries_matched INT) AS $$
DECLARE
  v_cdn_first INT;
  v_pass1 INT;
  v_pass5 INT;
  v_pass6 INT;
  v_pass7 INT;
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

  -- CDN-first: deterministic, ~75% of entries match here
  v_cdn_first := ops.match_master_list_by_clinic_day_number(p_clinic_date);

  -- Name-based and heuristic passes (for remaining unmatched entries)
  v_pass1 := ops.match_master_list_by_owner_name(p_clinic_date);
  v_pass5 := ops.match_master_list_by_foster(p_clinic_date);
  v_pass6 := ops.match_master_list_by_shelter_id(p_clinic_date);
  v_pass7 := ops.match_master_list_by_trapper(p_clinic_date);
  v_pass2 := ops.match_master_list_by_cat_name(p_clinic_date);
  v_pass3 := ops.match_master_list_by_sex(p_clinic_date);
  v_pass4 := ops.match_master_list_by_cardinality(p_clinic_date);

  -- Return results
  pass := 'cancelled_tagged'; entries_matched := v_cancelled; RETURN NEXT;
  pass := 'cdn_first'; entries_matched := v_cdn_first; RETURN NEXT;
  pass := 'owner_name'; entries_matched := v_pass1; RETURN NEXT;
  pass := 'foster'; entries_matched := v_pass5; RETURN NEXT;
  pass := 'shelter_id'; entries_matched := v_pass6; RETURN NEXT;
  pass := 'trapper_alias'; entries_matched := v_pass7; RETURN NEXT;
  pass := 'cat_name'; entries_matched := v_pass2; RETURN NEXT;
  pass := 'sex'; entries_matched := v_pass3; RETURN NEXT;
  pass := 'cardinality'; entries_matched := v_pass4; RETURN NEXT;
  pass := 'total'; entries_matched := v_cdn_first + v_pass1 + v_pass5 + v_pass6 + v_pass7 + v_pass2 + v_pass3 + v_pass4; RETURN NEXT;

  RETURN;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION ops.apply_smart_master_list_matches IS
  'Run all matching passes: cancelled detection → CDN-first → owner_name → foster → '
  'shelter_id → trapper_alias → cat_name → sex → cardinality. '
  'CDN-first runs FIRST because it is deterministic (75%+ match rate). FFS-1319.';

\echo '   ✓ CDN-first pass added as first matching strategy'

COMMIT;

\echo ''
\echo '=============================================='
\echo '  MIG_3100 Complete'
\echo '=============================================='
\echo ''
\echo 'Changes:'
\echo '  1. REMOVED CDN propagation from propagate_master_list_matches()'
\echo '     - Never set clinic_day_number from entry.line_number'
\echo '     - Prevents phantom CDN creation from name-matched entries'
\echo '  2. Added match_master_list_by_clinic_day_number to apply_smart_master_list_matches'
\echo '     - Runs FIRST (before owner_name) for deterministic matching'
\echo '     - ~75% of entries match by CDN alone'
\echo ''
\echo 'CDN should ONLY be set by:'
\echo '  - waiver_ocr (ops.set_clinic_day_number via bridge_waivers_by_weight)'
\echo '  - manual (staff via admin UI)'
\echo '  - CDN-first matching (requires CDN already exists on appointment)'
\echo ''
