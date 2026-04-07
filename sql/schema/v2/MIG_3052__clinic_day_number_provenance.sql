-- MIG_3052: clinic_day_number Single Source of Truth + provenance
--
-- Part of FFS-1150 (Atlas Data Hardening), Initiative 4 (FFS-1153).
--
-- Problem: clinic_day_number lives in 2 places and drifts:
--   - clinic_day_entries.line_number (authoritative, matches Excel master list)
--   - appointments.clinic_day_number (denormalized copy)
-- At least 5 appointments on 02/04/2026 had clinic_day_number values that
-- couldn't be traced to any known writer.
--
-- Solution:
--   1. Add clinic_day_number_source enum column to track which path set it
--   2. Create ops.set_clinic_day_number() as the single write path
--   3. Refuses to overwrite when the field is marked manually overridden
--      (MIG_3048) unless source='manual'
--   4. Backfill existing rows with inferred source
--
-- Depends on MIG_3048 (manually_overridden_fields + registry)
--
-- Created: 2026-04-06

\echo ''
\echo '=============================================='
\echo '  MIG_3052: clinic_day_number Provenance'
\echo '=============================================='
\echo ''

BEGIN;

-- ============================================================================
-- 1. Source enum
-- ============================================================================

\echo '1. Creating ops.clinic_day_number_source enum...'

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'clinic_day_number_source') THEN
    CREATE TYPE ops.clinic_day_number_source AS ENUM (
      'master_list',       -- from ops.clinic_day_entries via propagate_master_list_matches
      'clinichq_ingest',   -- from ClinicHQ 'Number' column
      'manual',            -- staff set via admin UI
      'cds_propagation',   -- set by CDS Phase 0.5/1.5 (dedup merge, shelter bridge)
      'legacy_v1'          -- migrated from v1 schema, source unknown
    );
    RAISE NOTICE '   Created type ops.clinic_day_number_source';
  ELSE
    RAISE NOTICE '   Type ops.clinic_day_number_source already exists';
  END IF;
END;
$$;

-- ============================================================================
-- 2. Add column
-- ============================================================================

\echo ''
\echo '2. Adding clinic_day_number_source column...'

ALTER TABLE ops.appointments
  ADD COLUMN IF NOT EXISTS clinic_day_number_source ops.clinic_day_number_source;

-- ============================================================================
-- 3. Backfill existing rows
-- ============================================================================
-- Strategy:
--   - If a clinic_day_entries row exists with matching line_number for the
--     same date and points to this appointment → 'master_list'
--   - Else if source_system = 'clinichq' AND source_record_id starts with
--     the clinic_day_number value → 'clinichq_ingest'
--   - Else → 'legacy_v1'

\echo ''
\echo '3. Backfilling clinic_day_number_source...'

-- 3a: master_list
UPDATE ops.appointments a
SET clinic_day_number_source = 'master_list'
FROM ops.clinic_day_entries e
JOIN ops.clinic_days cd ON cd.clinic_day_id = e.clinic_day_id
WHERE a.clinic_day_number IS NOT NULL
  AND a.clinic_day_number_source IS NULL
  AND e.line_number = a.clinic_day_number
  AND cd.clinic_date = a.appointment_date
  AND (e.appointment_id = a.appointment_id
       OR e.matched_appointment_id = a.appointment_id);

-- 3b: clinichq_ingest (source_record_id starts with the number, matches ingest format)
UPDATE ops.appointments
SET clinic_day_number_source = 'clinichq_ingest'
WHERE clinic_day_number IS NOT NULL
  AND clinic_day_number_source IS NULL
  AND source_system = 'clinichq'
  AND source_record_id LIKE clinic_day_number::TEXT || '_%';

-- 3c: everything else → legacy_v1
UPDATE ops.appointments
SET clinic_day_number_source = 'legacy_v1'
WHERE clinic_day_number IS NOT NULL
  AND clinic_day_number_source IS NULL;

DO $$
DECLARE
  v_total INT;
  v_master INT;
  v_clinichq INT;
  v_legacy INT;
  v_null INT;
BEGIN
  SELECT
    COUNT(*) FILTER (WHERE clinic_day_number IS NOT NULL),
    COUNT(*) FILTER (WHERE clinic_day_number_source = 'master_list'),
    COUNT(*) FILTER (WHERE clinic_day_number_source = 'clinichq_ingest'),
    COUNT(*) FILTER (WHERE clinic_day_number_source = 'legacy_v1'),
    COUNT(*) FILTER (WHERE clinic_day_number IS NOT NULL AND clinic_day_number_source IS NULL)
  INTO v_total, v_master, v_clinichq, v_legacy, v_null
  FROM ops.appointments
  WHERE merged_into_appointment_id IS NULL;

  RAISE NOTICE '   Backfill: % total, % master_list, % clinichq_ingest, % legacy_v1, % still NULL',
    v_total, v_master, v_clinichq, v_legacy, v_null;
END;
$$;

-- ============================================================================
-- 4. CHECK constraint: source required when value present
-- ============================================================================
-- Add as NOT VALID first to avoid failing on any remaining NULLs, then VALIDATE

\echo ''
\echo '4. Adding CHECK constraint (source required when value present)...'

ALTER TABLE ops.appointments
  DROP CONSTRAINT IF EXISTS chk_appointments_clinic_day_number_source;

ALTER TABLE ops.appointments
  ADD CONSTRAINT chk_appointments_clinic_day_number_source
  CHECK (clinic_day_number IS NULL OR clinic_day_number_source IS NOT NULL)
  NOT VALID;

-- Try to validate — will fail harmlessly if there are NULLs we couldn't backfill
DO $$
BEGIN
  BEGIN
    ALTER TABLE ops.appointments
      VALIDATE CONSTRAINT chk_appointments_clinic_day_number_source;
    RAISE NOTICE '   CHECK constraint validated';
  EXCEPTION WHEN check_violation THEN
    RAISE WARNING '   CHECK constraint remains NOT VALID — some rows still have NULL source. Investigate ops.appointments WHERE clinic_day_number IS NOT NULL AND clinic_day_number_source IS NULL';
  END;
END;
$$;

-- ============================================================================
-- 5. ops.set_clinic_day_number — the single write path
-- ============================================================================

\echo ''
\echo '5. Creating ops.set_clinic_day_number...'

CREATE OR REPLACE FUNCTION ops.set_clinic_day_number(
  p_appointment_id UUID,
  p_value          INTEGER,
  p_source         ops.clinic_day_number_source,
  p_changed_by     UUID DEFAULT NULL
) RETURNS BOOLEAN AS $$
DECLARE
  v_current INTEGER;
  v_current_source ops.clinic_day_number_source;
  v_manually_overridden BOOLEAN;
BEGIN
  SELECT
    clinic_day_number,
    clinic_day_number_source,
    ops.is_field_manually_set(manually_overridden_fields, 'clinic_day_number')
  INTO v_current, v_current_source, v_manually_overridden
  FROM ops.appointments
  WHERE appointment_id = p_appointment_id
    AND merged_into_appointment_id IS NULL;

  IF NOT FOUND THEN
    RAISE WARNING 'set_clinic_day_number: appointment % not found (or merged)', p_appointment_id;
    RETURN FALSE;
  END IF;

  -- Manual protection: if the field is flagged as manually overridden and
  -- this write is not itself a 'manual' source, refuse silently.
  IF v_manually_overridden AND p_source != 'manual' THEN
    RAISE NOTICE 'set_clinic_day_number: refusing % → % for appointment % (source=%, field is manually overridden)',
      v_current, p_value, p_appointment_id, p_source;
    RETURN FALSE;
  END IF;

  -- No-op if unchanged
  IF v_current IS NOT DISTINCT FROM p_value
     AND v_current_source IS NOT DISTINCT FROM p_source
  THEN
    RETURN TRUE;
  END IF;

  -- Update + log
  UPDATE ops.appointments
  SET clinic_day_number = p_value,
      clinic_day_number_source = CASE WHEN p_value IS NULL THEN NULL ELSE p_source END,
      manually_overridden_fields = CASE
        WHEN p_source = 'manual'
             AND NOT ops.is_field_manually_set(manually_overridden_fields, 'clinic_day_number')
        THEN array_append(manually_overridden_fields, 'clinic_day_number')
        ELSE manually_overridden_fields
      END,
      updated_at = NOW()
  WHERE appointment_id = p_appointment_id;

  INSERT INTO ops.entity_edits (
    entity_type, entity_id, field_name, old_value, new_value,
    changed_by, change_source
  ) VALUES (
    'ops.appointments',
    p_appointment_id,
    'clinic_day_number',
    v_current::TEXT,
    p_value::TEXT,
    p_changed_by,
    p_source::TEXT
  );

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION ops.set_clinic_day_number IS
'MIG_3052: The single write path for ops.appointments.clinic_day_number.
Enforces provenance (source enum) and manual override protection (MIG_3048).
Refuses auto writes when the field is flagged as manually overridden.
All direct UPDATE statements on clinic_day_number should be replaced with
calls to this function.';

-- ============================================================================
-- 6. Update propagate_master_list_matches to set source
-- ============================================================================
-- Both overloads from MIG_3048 need to set clinic_day_number_source = 'master_list'
-- when they propagate values.

\echo ''
\echo '6. Updating propagate_master_list_matches overloads to set source...'

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

  -- Propagate clinic_day_number from entries to appointments
  -- MIG_3048: skip manually-overridden rows
  -- MIG_3052: also set clinic_day_number_source = 'master_list'
  UPDATE ops.appointments a
  SET clinic_day_number = e.line_number,
      clinic_day_number_source = 'master_list'
  FROM ops.clinic_day_entries e
  WHERE e.appointment_id = a.appointment_id
    AND a.clinic_day_number IS NULL
    AND e.line_number IS NOT NULL
    AND a.merged_into_appointment_id IS NULL
    AND NOT ops.is_field_manually_set(a.manually_overridden_fields, 'clinic_day_number');
  GET DIAGNOSTICS v_numbers_propagated = ROW_COUNT;

  RETURN QUERY SELECT v_appointments_updated, v_cats_linked, v_numbers_propagated;
END;
$$;

CREATE OR REPLACE FUNCTION ops.propagate_master_list_matches(p_date DATE)
RETURNS TABLE(propagated INT, cat_ids_linked INT) AS $$
DECLARE
    v_propagated INT;
    v_cat_ids INT;
BEGIN
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

    -- Propagate clinic_day_number (date-scoped) with source='master_list'
    -- MIG_3048: skip manually-overridden rows
    UPDATE ops.appointments a
    SET clinic_day_number = e.line_number,
        clinic_day_number_source = 'master_list'
    FROM ops.clinic_day_entries e
    JOIN ops.clinic_days cd ON cd.clinic_day_id = e.clinic_day_id
    WHERE e.appointment_id = a.appointment_id
      AND cd.clinic_date = p_date
      AND a.clinic_day_number IS NULL
      AND e.line_number IS NOT NULL
      AND a.merged_into_appointment_id IS NULL
      AND NOT ops.is_field_manually_set(a.manually_overridden_fields, 'clinic_day_number');

    RETURN QUERY SELECT v_propagated, v_cat_ids;
END;
$$ LANGUAGE plpgsql;

\echo '   Updated both overloads to set source=master_list'

-- ============================================================================
-- 7. Verification
-- ============================================================================

\echo ''
\echo '7. Verification...'

SELECT clinic_day_number_source, COUNT(*)::INT AS count
FROM ops.appointments
WHERE clinic_day_number IS NOT NULL
  AND merged_into_appointment_id IS NULL
GROUP BY clinic_day_number_source
ORDER BY 2 DESC;

SELECT
  n.nspname || '.' || p.proname AS function_name
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'ops' AND p.proname = 'set_clinic_day_number';

COMMIT;

\echo ''
\echo '=============================================='
\echo '  MIG_3052 Complete'
\echo '=============================================='
\echo ''
\echo 'Changes:'
\echo '  1. Created ops.clinic_day_number_source enum'
\echo '  2. Added clinic_day_number_source column to ops.appointments'
\echo '  3. Backfilled existing rows (master_list / clinichq_ingest / legacy_v1)'
\echo '  4. Added CHECK constraint: source required when value present'
\echo '  5. Created ops.set_clinic_day_number() — the single write path'
\echo '  6. Updated propagate_master_list_matches overloads to tag source'
\echo ''
\echo 'Next steps:'
\echo '  - Refactor apps/web/src/app/api/appointments/[id]/route.ts PATCH'
\echo '    to use ops.set_clinic_day_number(..., source=manual)'
\echo '  - Refactor apps/web/src/lib/cds.ts dedupeAppointments to use'
\echo '    source=cds_propagation when transferring from loser to winner'
\echo ''
