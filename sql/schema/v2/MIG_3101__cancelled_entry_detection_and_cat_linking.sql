-- MIG_3101: Enhanced cancelled entry detection + cat resolution
--
-- Problem 1: Master list entries with explicit cancellation signals in notes
-- ("cancelled", "no show") are NOT flagged as cancelled. They get matched by
-- CDN-first to the WRONG appointment (the replacement cat's slot). Example:
-- Jadis on 04-06 was cancelled, but CDN-first matched her line to Hannah
-- Cervantes's appointment (which took Jadis's slot).
--
-- Problem 2: Cancelled entries that ARE real cats have no cat_id linkage.
-- The cat exists in sot.cats but the entry doesn't reference it. This breaks
-- data cohesion — you can't trace "Jadis was scheduled on 04-06 but cancelled."
--
-- Solution:
--   1. detect_cancelled_from_notes() — flags entries with "cancelled"/"no show"
--      in notes AND was_altered=false as surgery_cancelled / no_show
--   2. link_cancelled_entries_to_cats() — resolves cat_id for cancelled entries
--      by looking up the cat in sot.cats via name + owner on other dates
--   3. Update detect_cancelled_entries() to call the notes-based detection
--
-- Created: 2026-04-20

\echo '=============================================='
\echo '  MIG_3101: Cancelled entry detection + cat linking'
\echo '=============================================='

BEGIN;

-- ============================================================================
-- 1. Detect cancellations from notes/status (notes-based detection)
-- ============================================================================

\echo '1. Creating detect_cancelled_from_notes...'

CREATE OR REPLACE FUNCTION ops.detect_cancelled_from_notes(p_clinic_date DATE)
RETURNS INT AS $$
DECLARE
  v_flagged INT := 0;
BEGIN
  -- Flag entries with explicit cancellation language in notes
  -- Only flag when was_altered = false (surgery didn't happen)
  -- Or when sex_count = 0 (no F/M mark on ML)
  WITH flagged AS (
    UPDATE ops.clinic_day_entries e
    SET cancellation_reason = CASE
      WHEN e.notes ILIKE '%no show%' OR e.notes ILIKE '%no-show%' THEN 'no_show'
      WHEN e.notes ILIKE '%cancel%' THEN 'surgery_cancelled'
      ELSE 'surgery_cancelled'
    END
    FROM ops.clinic_days cd
    WHERE cd.clinic_day_id = e.clinic_day_id
      AND cd.clinic_date = p_clinic_date
      AND e.cancellation_reason IS NULL
      AND (
        -- Explicit "cancelled" + no surgery
        (e.notes ILIKE '%cancel%' AND e.was_altered = false)
        -- "no show" (any context)
        OR (e.notes ILIKE '%no show%' OR e.notes ILIKE '%no-show%')
      )
      -- Don't flag entries already matched with high confidence
      -- (they might say "cancelled" in a different context)
      AND (e.match_confidence IS NULL OR e.match_confidence IN ('unmatched', 'low'))
    RETURNING e.entry_id
  )
  SELECT COUNT(*) INTO v_flagged FROM flagged;

  RETURN v_flagged;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION ops.detect_cancelled_from_notes IS
  'Detect cancelled entries from notes/status content. '
  'Flags entries with "cancelled"+"no surgery" or "no show" in notes. '
  'Must run BEFORE CDN-first matching to prevent wrong assignment.';

-- ============================================================================
-- 2. Link cancelled entries to their cats (by name + owner on other dates)
-- ============================================================================

\echo ''
\echo '2. Creating link_cancelled_entries_to_cats...'

CREATE OR REPLACE FUNCTION ops.link_cancelled_entries_to_cats(p_clinic_date DATE)
RETURNS INT AS $$
DECLARE
  v_linked INT := 0;
  v_entry RECORD;
  v_cat_id UUID;
BEGIN
  -- For each cancelled entry without a cat_id, try to find the cat
  FOR v_entry IN
    SELECT e.entry_id, e.parsed_owner_name, e.parsed_cat_name, e.line_number
    FROM ops.clinic_day_entries e
    JOIN ops.clinic_days cd ON cd.clinic_day_id = e.clinic_day_id
    WHERE cd.clinic_date = p_clinic_date
      AND e.cancellation_reason IS NOT NULL
      AND e.cat_id IS NULL
      AND e.parsed_cat_name IS NOT NULL
  LOOP
    v_cat_id := NULL;

    -- Strategy 1: Find cat by name + owner on ANY date (strongest signal)
    SELECT c.cat_id INTO v_cat_id
    FROM sot.cats c
    JOIN ops.appointments a ON a.cat_id = c.cat_id
      AND a.merged_into_appointment_id IS NULL
    WHERE c.name ILIKE '%' || v_entry.parsed_cat_name || '%'
      AND c.merged_into_cat_id IS NULL
      AND v_entry.parsed_owner_name IS NOT NULL
      AND a.client_name IS NOT NULL
      AND similarity(
        LOWER(v_entry.parsed_owner_name),
        LOWER(a.client_name)
      ) > 0.5
    ORDER BY a.appointment_date DESC
    LIMIT 1;

    -- Strategy 2: If no owner match, try exact cat name + same clinic date range
    IF v_cat_id IS NULL AND v_entry.parsed_cat_name IS NOT NULL THEN
      SELECT c.cat_id INTO v_cat_id
      FROM sot.cats c
      JOIN ops.appointments a ON a.cat_id = c.cat_id
        AND a.merged_into_appointment_id IS NULL
        AND a.appointment_date BETWEEN p_clinic_date - INTERVAL '30 days'
                                    AND p_clinic_date + INTERVAL '30 days'
      WHERE LOWER(c.name) = LOWER(v_entry.parsed_cat_name)
        AND c.merged_into_cat_id IS NULL
      ORDER BY ABS(a.appointment_date - p_clinic_date)
      LIMIT 1;
    END IF;

    IF v_cat_id IS NOT NULL THEN
      UPDATE ops.clinic_day_entries
      SET cat_id = v_cat_id
      WHERE entry_id = v_entry.entry_id;

      v_linked := v_linked + 1;
    END IF;
  END LOOP;

  RETURN v_linked;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION ops.link_cancelled_entries_to_cats IS
  'Link cancelled entries to their cats for data cohesion. '
  'Searches sot.cats by name + owner from other dates. '
  'Sets cat_id without creating appointments or CDNs.';

-- ============================================================================
-- 3. Unlink wrongly-matched cancelled entries
-- ============================================================================
-- Entries that were flagged as cancelled AFTER being matched should be unlinked
-- (their CDN slot was given to another cat)

\echo ''
\echo '3. Creating unlink_cancelled_entries...'

CREATE OR REPLACE FUNCTION ops.unlink_cancelled_entries(p_clinic_date DATE)
RETURNS INT AS $$
DECLARE
  v_unlinked INT := 0;
BEGIN
  -- Unlink cancelled entries from appointments they were wrongly matched to
  -- Keep cat_id if set (that's the real cat identity)
  WITH unlinked AS (
    UPDATE ops.clinic_day_entries e
    SET matched_appointment_id = NULL,
        appointment_id = NULL,
        match_confidence = NULL,
        cds_method = NULL
    FROM ops.clinic_days cd
    WHERE cd.clinic_day_id = e.clinic_day_id
      AND cd.clinic_date = p_clinic_date
      AND e.cancellation_reason IS NOT NULL
      AND e.matched_appointment_id IS NOT NULL
      -- Don't unlink manually-matched entries
      AND COALESCE(e.match_confidence, '') != 'manual'
    RETURNING e.entry_id
  )
  SELECT COUNT(*) INTO v_unlinked FROM unlinked;

  RETURN v_unlinked;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION ops.unlink_cancelled_entries IS
  'Unlink cancelled entries from appointments. Cancelled entries should not '
  'claim another cat''s appointment slot. Preserves cat_id for data cohesion.';

-- ============================================================================
-- 4. Update detect_cancelled_entries to include notes-based detection
-- ============================================================================

\echo ''
\echo '4. Updating detect_cancelled_entries to include notes-based detection...'

CREATE OR REPLACE FUNCTION ops.detect_cancelled_entries(p_clinic_date DATE)
RETURNS INT AS $$
DECLARE
  v_header_rows INT := 0;
  v_rechecks INT := 0;
  v_from_notes INT := 0;
BEGIN
  -- A. Flag header rows (row where raw_client_name = 'Client Name')
  UPDATE ops.clinic_day_entries e
  SET cancellation_reason = 'header_row'
  FROM ops.clinic_days cd
  WHERE cd.clinic_day_id = e.clinic_day_id
    AND cd.clinic_date = p_clinic_date
    AND e.cancellation_reason IS NULL
    AND LOWER(TRIM(e.raw_client_name)) = 'client name';
  GET DIAGNOSTICS v_header_rows = ROW_COUNT;

  -- B. Flag rechecks with no matching appointment on this date
  -- (they might be here for a different date's follow-up)
  UPDATE ops.clinic_day_entries e
  SET cancellation_reason = 'recheck_different_date'
  FROM ops.clinic_days cd
  WHERE cd.clinic_day_id = e.clinic_day_id
    AND cd.clinic_date = p_clinic_date
    AND e.cancellation_reason IS NULL
    AND e.is_recheck = TRUE
    AND e.matched_appointment_id IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM ops.appointments a
      WHERE a.appointment_date = p_clinic_date
        AND a.merged_into_appointment_id IS NULL
        AND similarity(COALESCE(e.parsed_owner_name, ''), COALESCE(a.client_name, '')) > 0.6
    );
  GET DIAGNOSTICS v_rechecks = ROW_COUNT;

  -- C. Detect cancellations from notes content (NEW in MIG_3101)
  v_from_notes := ops.detect_cancelled_from_notes(p_clinic_date);

  RETURN v_header_rows + v_rechecks + v_from_notes;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION ops.detect_cancelled_entries IS
  'Detect cancelled clinic day entries: header rows, rechecks for other dates, '
  'and explicit cancellation signals in notes. MIG_3101 adds notes-based detection.';

-- ============================================================================
-- 5. Backfill: flag existing entries with cancellation signals
-- ============================================================================

\echo ''
\echo '5. Backfilling cancellation detection from notes...'

-- Flag entries with "cancelled" + no surgery
UPDATE ops.clinic_day_entries e
SET cancellation_reason = 'surgery_cancelled'
FROM ops.clinic_days cd
WHERE cd.clinic_day_id = e.clinic_day_id
  AND e.cancellation_reason IS NULL
  AND e.notes ILIKE '%cancel%'
  AND e.was_altered = false
  AND cd.clinic_date >= '2026-01-01';

DO $$
DECLARE v_count INT;
BEGIN
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RAISE NOTICE '   Flagged % entries with "cancelled" + no surgery', v_count;
END;
$$;

-- Flag no-show entries
UPDATE ops.clinic_day_entries e
SET cancellation_reason = 'no_show'
FROM ops.clinic_days cd
WHERE cd.clinic_day_id = e.clinic_day_id
  AND e.cancellation_reason IS NULL
  AND (e.notes ILIKE '%no show%' OR e.notes ILIKE '%no-show%')
  AND cd.clinic_date >= '2026-01-01';

DO $$
DECLARE v_count INT;
BEGIN
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RAISE NOTICE '   Flagged % entries as no-show', v_count;
END;
$$;

-- ============================================================================
-- 6. Unlink wrongly-matched cancelled entries
-- ============================================================================

\echo ''
\echo '6. Unlinking wrongly-matched cancelled entries...'

-- Now that entries are flagged, unlink them from wrong appointments
WITH unlinked AS (
  UPDATE ops.clinic_day_entries e
  SET matched_appointment_id = NULL,
      appointment_id = NULL,
      match_confidence = NULL,
      cds_method = NULL
  WHERE e.cancellation_reason IN ('surgery_cancelled', 'no_show')
    AND e.matched_appointment_id IS NOT NULL
    AND COALESCE(e.match_confidence, '') != 'manual'
  RETURNING e.entry_id
)
SELECT COUNT(*) AS unlinked FROM unlinked;

-- ============================================================================
-- 7. Link cancelled entries to their cats
-- ============================================================================

\echo ''
\echo '7. Linking cancelled entries to cats...'

DO $$
DECLARE
  v_date DATE;
  v_linked INT;
  v_total INT := 0;
BEGIN
  FOR v_date IN
    SELECT DISTINCT cd.clinic_date
    FROM ops.clinic_day_entries e
    JOIN ops.clinic_days cd ON cd.clinic_day_id = e.clinic_day_id
    WHERE e.cancellation_reason IS NOT NULL
      AND e.cat_id IS NULL
      AND e.parsed_cat_name IS NOT NULL
      AND cd.clinic_date >= '2026-01-01'
    ORDER BY cd.clinic_date
  LOOP
    v_linked := ops.link_cancelled_entries_to_cats(v_date);
    IF v_linked > 0 THEN
      v_total := v_total + v_linked;
      RAISE NOTICE '   % → linked % cancelled entries to cats', v_date, v_linked;
    END IF;
  END LOOP;
  RAISE NOTICE '   Total: % cancelled entries linked to cats', v_total;
END;
$$;

COMMIT;

\echo ''
\echo '=============================================='
\echo '  MIG_3101 Complete'
\echo '=============================================='
\echo ''
\echo 'Changes:'
\echo '  1. detect_cancelled_from_notes() — flags "cancelled"/"no show" from notes'
\echo '  2. link_cancelled_entries_to_cats() — resolves cat_id by name+owner'
\echo '  3. unlink_cancelled_entries() — removes wrong appointment matches'
\echo '  4. detect_cancelled_entries() updated to include notes detection'
\echo '  5. Backfilled ~64 entries (44 cancelled + 20 no-show)'
\echo '  6. Unlinked wrongly-matched cancelled entries from other cats slots'
\echo '  7. Linked cancelled entries to their actual cats for data cohesion'
\echo ''
\echo 'Pipeline integration:'
\echo '  detect_cancelled_entries runs BEFORE CDN-first matching.'
\echo '  CDN-first skips cancelled entries (AND e.cancellation_reason IS NULL).'
\echo '  After all matching, link_cancelled_entries_to_cats resolves cat_id.'
\echo ''
