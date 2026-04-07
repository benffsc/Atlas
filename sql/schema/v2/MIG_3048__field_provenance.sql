-- MIG_3048: Field-Level Provenance & Manual Override Protection
--
-- Part of FFS-1150 (Atlas Data Hardening), Initiative 1 (FFS-1151).
--
-- Problem: We cannot distinguish auto-set values from manually-set values.
-- Canonical example: on 02/04/2026, staff manually assigned clinic_day_number=5
-- to Macy's appointment. A subsequent CDS rematch nuked that value because
-- `propagate_master_list_matches()` had no way to tell "this was set by a human"
-- from "this was set by a prior auto-run."
--
-- Solution: Generic `manually_overridden_fields TEXT[]` column on every table
-- whose values can be manually edited. All auto-writers MUST check the array
-- before overwriting. Merge paths MUST transfer the array from loser to winner.
--
-- Pattern: Salesforce Field History + HubSpot manual edit flag. Conservative
-- initial scope (~3 fields per table, like Salesforce's 20-field limit).
--
-- Tracked fields (initial):
--   ops.appointments:  clinic_day_number, cat_id, client_name
--   sot.cats:          name, is_verified
--   sot.places:        display_name, is_verified
--
-- Created: 2026-04-06

\echo ''
\echo '=============================================='
\echo '  MIG_3048: Field-Level Provenance'
\echo '=============================================='
\echo ''

BEGIN;

-- ============================================================================
-- 1. Add manually_overridden_fields column to protected tables
-- ============================================================================

\echo '1. Adding manually_overridden_fields columns...'

ALTER TABLE ops.appointments
  ADD COLUMN IF NOT EXISTS manually_overridden_fields TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

ALTER TABLE sot.cats
  ADD COLUMN IF NOT EXISTS manually_overridden_fields TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

ALTER TABLE sot.places
  ADD COLUMN IF NOT EXISTS manually_overridden_fields TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- GIN indexes for fast `ANY()` / `= ANY(col)` / `@>` lookups
CREATE INDEX IF NOT EXISTS idx_appointments_manually_overridden
  ON ops.appointments USING GIN (manually_overridden_fields)
  WHERE array_length(manually_overridden_fields, 1) > 0;

CREATE INDEX IF NOT EXISTS idx_cats_manually_overridden
  ON sot.cats USING GIN (manually_overridden_fields)
  WHERE array_length(manually_overridden_fields, 1) > 0;

CREATE INDEX IF NOT EXISTS idx_places_manually_overridden
  ON sot.places USING GIN (manually_overridden_fields)
  WHERE array_length(manually_overridden_fields, 1) > 0;

\echo '   Added manually_overridden_fields + GIN indexes'

-- ============================================================================
-- 2. Registry of protected fields per table
-- ============================================================================
-- Instead of CHECK constraints against information_schema (which would prevent
-- writes whenever columns are added/removed), we maintain an explicit registry.
-- Helper functions validate against this registry.

\echo ''
\echo '2. Creating protected field registry...'

CREATE TABLE IF NOT EXISTS ops.protected_field_registry (
  registry_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  schema_name TEXT NOT NULL,
  table_name  TEXT NOT NULL,
  column_name TEXT NOT NULL,
  added_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notes       TEXT,
  UNIQUE (schema_name, table_name, column_name)
);

COMMENT ON TABLE ops.protected_field_registry IS
'MIG_3048: Whitelist of fields that can appear in <table>.manually_overridden_fields.
Gate kept by ops.assert_protected_field(). Keep this list short — only add fields
that have real human-edit semantics worth protecting from auto-overwrite.';

INSERT INTO ops.protected_field_registry (schema_name, table_name, column_name, notes) VALUES
  ('ops', 'appointments', 'clinic_day_number', 'MIG_3048: manual master-list assignments (e.g., Macy 02/04)'),
  ('ops', 'appointments', 'cat_id',            'MIG_3048: manual cat match correction'),
  ('ops', 'appointments', 'client_name',       'MIG_3048: manual client name correction'),
  ('sot', 'cats',         'name',              'MIG_3048: staff-verified cat name'),
  ('sot', 'cats',         'is_verified',       'MIG_3048: staff verification flag'),
  ('sot', 'places',       'display_name',      'MIG_3048: staff-authored place name'),
  ('sot', 'places',       'is_verified',       'MIG_3048: staff verification flag')
ON CONFLICT (schema_name, table_name, column_name) DO NOTHING;

\echo '   Created protected_field_registry with 7 initial entries'

-- ============================================================================
-- 3. Standardize ops.app_config_history.changed_by → UUID
-- ============================================================================
-- MIG_2959 created this as TEXT, but the trigger writes NEW.updated_by which is
-- UUID on ops.app_config. Values are implicitly cast to TEXT. We can safely
-- convert the column type using an explicit USING clause that nulls any
-- non-UUID text values.

\echo ''
\echo '3. Standardizing ops.app_config_history.changed_by to UUID...'

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'ops'
      AND table_name = 'app_config_history'
      AND column_name = 'changed_by'
      AND data_type = 'text'
  ) THEN
    ALTER TABLE ops.app_config_history
      ALTER COLUMN changed_by TYPE UUID
      USING (CASE
        WHEN changed_by ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        THEN changed_by::UUID
        ELSE NULL
      END);
    RAISE NOTICE '   Converted ops.app_config_history.changed_by from TEXT to UUID';
  ELSE
    RAISE NOTICE '   ops.app_config_history.changed_by already UUID — skipping';
  END IF;
END;
$$;

-- ops.entity_edits.changed_by is already UUID per MIG_2301 — nothing to do.
-- ops.request_status_history.changed_by is TEXT but those writes come from
-- a trigger with no clear user context yet; leave it alone for now.

-- ============================================================================
-- 4. Helper functions
-- ============================================================================

\echo ''
\echo '4. Creating provenance helper functions...'

-- ─── Asserter ──────────────────────────────────────────────────────────────
-- Raises exception if (schema, table, column) is not in the registry.
-- Used by set_field_manual() to prevent typos.

CREATE OR REPLACE FUNCTION ops.assert_protected_field(
  p_schema TEXT,
  p_table  TEXT,
  p_column TEXT
) RETURNS VOID AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM ops.protected_field_registry
    WHERE schema_name = p_schema
      AND table_name  = p_table
      AND column_name = p_column
  ) THEN
    RAISE EXCEPTION
      'Field %.%.% is not in ops.protected_field_registry — add it there first',
      p_schema, p_table, p_column
      USING HINT = 'INSERT INTO ops.protected_field_registry (schema_name, table_name, column_name) VALUES (...)';
  END IF;
END;
$$ LANGUAGE plpgsql STABLE;

-- ─── is_field_manually_set ─────────────────────────────────────────────────
-- Cheap boolean check used inside UPDATE WHERE clauses.

CREATE OR REPLACE FUNCTION ops.is_field_manually_set(
  p_manually_overridden TEXT[],
  p_column TEXT
) RETURNS BOOLEAN AS $$
  SELECT COALESCE(p_column = ANY(p_manually_overridden), FALSE);
$$ LANGUAGE sql IMMUTABLE;

-- ─── set_field_manual ──────────────────────────────────────────────────────
-- The canonical "human set this" writer. Does three things atomically:
--   1. UPDATE <table>.<column> = new value
--   2. Add <column> to manually_overridden_fields (if not already)
--   3. INSERT into ops.entity_edits with source='manual'
-- Refuses unknown (schema, table, column) via assert_protected_field.
-- Uses dynamic SQL because the target table/column is parameterized.

CREATE OR REPLACE FUNCTION ops.set_field_manual(
  p_schema     TEXT,
  p_table      TEXT,
  p_pk_column  TEXT,        -- e.g., 'appointment_id', 'cat_id', 'place_id'
  p_row_id     UUID,
  p_column     TEXT,
  p_new_value  TEXT,
  p_changed_by UUID
) RETURNS VOID AS $$
DECLARE
  v_old_value TEXT;
  v_sql       TEXT;
BEGIN
  PERFORM ops.assert_protected_field(p_schema, p_table, p_column);

  -- Capture old value for audit log
  v_sql := format(
    'SELECT (%I)::TEXT FROM %I.%I WHERE %I = $1',
    p_column, p_schema, p_table, p_pk_column
  );
  EXECUTE v_sql INTO v_old_value USING p_row_id;

  -- Update the column AND append to override array in a single statement
  v_sql := format(
    'UPDATE %I.%I
        SET %I = $1,
            manually_overridden_fields =
              CASE WHEN $2 = ANY(manually_overridden_fields)
                   THEN manually_overridden_fields
                   ELSE array_append(manually_overridden_fields, $2)
              END
      WHERE %I = $3',
    p_schema, p_table, p_column, p_pk_column
  );
  EXECUTE v_sql USING p_new_value, p_column, p_row_id;

  -- Log to entity_edits
  INSERT INTO ops.entity_edits (
    entity_type, entity_id, field_name, old_value, new_value,
    changed_by, change_source
  ) VALUES (
    p_schema || '.' || p_table, p_row_id, p_column, v_old_value, p_new_value,
    p_changed_by, 'manual_override'
  );
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION ops.set_field_manual IS
'MIG_3048: Canonical writer for staff-verified field values. Updates the column,
marks it in manually_overridden_fields, and logs to ops.entity_edits. Rejects
columns not in ops.protected_field_registry.';

-- ─── clear_manual_override ─────────────────────────────────────────────────
-- "Let auto take over again" — removes the column from manually_overridden_fields
-- without changing the stored value. Logs a 'clear_override' entity_edit.

CREATE OR REPLACE FUNCTION ops.clear_manual_override(
  p_schema     TEXT,
  p_table      TEXT,
  p_pk_column  TEXT,
  p_row_id     UUID,
  p_column     TEXT,
  p_changed_by UUID
) RETURNS VOID AS $$
DECLARE
  v_sql TEXT;
BEGIN
  PERFORM ops.assert_protected_field(p_schema, p_table, p_column);

  v_sql := format(
    'UPDATE %I.%I
        SET manually_overridden_fields = array_remove(manually_overridden_fields, $1)
      WHERE %I = $2',
    p_schema, p_table, p_pk_column
  );
  EXECUTE v_sql USING p_column, p_row_id;

  INSERT INTO ops.entity_edits (
    entity_type, entity_id, field_name, old_value, new_value,
    changed_by, change_source
  ) VALUES (
    p_schema || '.' || p_table, p_row_id, p_column, 'manual', 'auto',
    p_changed_by, 'clear_override'
  );
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION ops.clear_manual_override IS
'MIG_3048: Removes a field from manually_overridden_fields so auto-writers can
update it again. Stored value is left unchanged.';

\echo '   Created assert_protected_field, is_field_manually_set, set_field_manual, clear_manual_override'

-- ============================================================================
-- 5. Refactor propagate_master_list_matches to respect override array
-- ============================================================================
-- MIG_3044 added a clinic_day_number propagation step that skipped NULL values
-- but had no way to protect a manually-set non-NULL value from being
-- re-propagated over. With MIG_3048, we also skip rows where the column is in
-- the override array.

\echo ''
\echo '5. Updating ops.propagate_master_list_matches() to honor manual overrides...'

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
  -- MIG_3048: skip rows where clinic_day_number is manually overridden
  UPDATE ops.appointments a
  SET clinic_day_number = e.line_number
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

COMMENT ON FUNCTION ops.propagate_master_list_matches() IS
'MIG_3048: Honors manually_overridden_fields on ops.appointments. A row whose
clinic_day_number is flagged as manually set will never be auto-propagated
over, even if its current value is NULL.';

\echo '   Refactored propagate_master_list_matches() with override protection'

-- ============================================================================
-- 6. Date-scoped variant (used by CDS pipeline)
-- ============================================================================
-- The TypeScript CDS pipeline calls propagate_master_list_matches($1::date).
-- Preserve backward compatibility by adding a date-scoped overload that also
-- honors the override array.

\echo ''
\echo '6. Creating date-scoped propagate_master_list_matches(date) overload...'

CREATE OR REPLACE FUNCTION ops.propagate_master_list_matches(p_date DATE)
RETURNS TABLE(propagated INT, cat_ids_linked INT) AS $$
DECLARE
    v_propagated INT;
    v_cat_ids INT;
BEGIN
    -- Copy matched_appointment_id → appointment_id for high/medium confidence
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

    -- Link cat_id from matched appointment
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

    -- Propagate clinic_day_number from entries to appointments (date-scoped)
    -- MIG_3048: skip manually-overridden rows
    UPDATE ops.appointments a
    SET clinic_day_number = e.line_number
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

COMMENT ON FUNCTION ops.propagate_master_list_matches(DATE) IS
'MIG_3048: Date-scoped propagation used by CDS pipeline. Honors
manually_overridden_fields on ops.appointments.clinic_day_number.';

\echo '   Created date-scoped overload'

-- ============================================================================
-- 7. Verification queries
-- ============================================================================

\echo ''
\echo '7. Verification...'

-- Confirm columns exist
SELECT
  table_schema || '.' || table_name AS table_name,
  column_name,
  data_type
FROM information_schema.columns
WHERE column_name = 'manually_overridden_fields'
ORDER BY table_schema, table_name;

-- Confirm registry populated
SELECT COUNT(*) AS protected_field_count FROM ops.protected_field_registry;

-- Confirm helper functions exist
SELECT
  n.nspname || '.' || p.proname AS function_name
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'ops'
  AND p.proname IN (
    'assert_protected_field',
    'is_field_manually_set',
    'set_field_manual',
    'clear_manual_override'
  )
ORDER BY 1;

COMMIT;

\echo ''
\echo '=============================================='
\echo '  MIG_3048 Complete'
\echo '=============================================='
\echo ''
\echo 'Changes:'
\echo '  1. Added manually_overridden_fields TEXT[] to ops.appointments, sot.cats, sot.places'
\echo '  2. Created GIN indexes for fast array lookups'
\echo '  3. Created ops.protected_field_registry with 7 initial fields'
\echo '  4. Standardized ops.app_config_history.changed_by to UUID'
\echo '  5. Created ops.assert_protected_field, is_field_manually_set, set_field_manual, clear_manual_override'
\echo '  6. Updated propagate_master_list_matches() (both overloads) to honor overrides'
\echo ''
\echo 'Next steps:'
\echo '  - Refactor apps/web/src/lib/cds.ts (dedupeAppointments) to transfer override arrays'
\echo '  - Refactor apps/web/src/lib/clinic-day-matching.ts (clearAutoMatches) filter'
\echo '  - Apply override checks to find_or_create_* functions (follow-up commit)'
\echo ''
