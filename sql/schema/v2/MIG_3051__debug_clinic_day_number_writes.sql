-- MIG_3051: Debug trigger to find mystery clinic_day_number writers
--
-- Part of FFS-1150 (Atlas Data Hardening), Initiative 4 (FFS-1153).
--
-- Problem: Multiple paths write to ops.appointments.clinic_day_number.
-- Known writers: propagate_master_list_matches, cds.ts dedupeAppointments,
-- admin PATCH /api/appointments/[id]. Today's 02/04 debug session surfaced
-- 5 appointments with clinic_day_number values that don't appear in any
-- known writer. Before locking down the write path with MIG_3052, we need
-- to know what else is setting this column.
--
-- This migration installs a lightweight trigger that logs every change to
-- ops.appointments.clinic_day_number along with the calling session's
-- user, current query, and call site hints. Leave it running for ~1 week
-- then drop it.
--
-- Drop with: DROP TRIGGER trg_debug_clinic_day_number ON ops.appointments;
--
-- Created: 2026-04-06

\echo ''
\echo '=============================================='
\echo '  MIG_3051: Debug clinic_day_number writes'
\echo '=============================================='
\echo ''

BEGIN;

-- ============================================================================
-- 1. Log table
-- ============================================================================

CREATE TABLE IF NOT EXISTS ops.debug_clinic_day_number_writes (
  log_id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  appointment_id UUID NOT NULL,
  old_value      INTEGER,
  new_value      INTEGER,
  db_session_user   TEXT,
  application_name TEXT,
  inet_client_addr TEXT,
  current_query  TEXT,
  changed_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_debug_clinic_day_number_writes_appt
  ON ops.debug_clinic_day_number_writes (appointment_id, changed_at DESC);

CREATE INDEX IF NOT EXISTS idx_debug_clinic_day_number_writes_time
  ON ops.debug_clinic_day_number_writes (changed_at DESC);

COMMENT ON TABLE ops.debug_clinic_day_number_writes IS
'MIG_3051: Temporary audit trail for ALL writes to clinic_day_number.
Intended to run ~1 week to identify mystery writers before MIG_3052
locks down the write path. Drop after review.';

-- ============================================================================
-- 2. Trigger function
-- ============================================================================

CREATE OR REPLACE FUNCTION ops.debug_log_clinic_day_number_write()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.clinic_day_number IS DISTINCT FROM NEW.clinic_day_number THEN
    INSERT INTO ops.debug_clinic_day_number_writes (
      appointment_id, old_value, new_value,
      db_session_user, application_name, inet_client_addr, current_query
    ) VALUES (
      NEW.appointment_id,
      OLD.clinic_day_number,
      NEW.clinic_day_number,
      SESSION_USER,
      current_setting('application_name', TRUE),
      COALESCE(inet_client_addr()::TEXT, 'local'),
      LEFT(current_query(), 2000)
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- 3. Attach trigger
-- ============================================================================

DROP TRIGGER IF EXISTS trg_debug_clinic_day_number ON ops.appointments;
CREATE TRIGGER trg_debug_clinic_day_number
  AFTER UPDATE OF clinic_day_number ON ops.appointments
  FOR EACH ROW
  EXECUTE FUNCTION ops.debug_log_clinic_day_number_write();

\echo '   Installed debug trigger on ops.appointments.clinic_day_number'

-- ============================================================================
-- 4. Summary view
-- ============================================================================

CREATE OR REPLACE VIEW ops.v_debug_clinic_day_number_sources AS
SELECT
  application_name,
  db_session_user,
  -- Collapse identical query text
  LEFT(REGEXP_REPLACE(current_query, '\s+', ' ', 'g'), 200) AS query_prefix,
  COUNT(*)::INT AS write_count,
  MIN(changed_at) AS first_seen,
  MAX(changed_at) AS last_seen
FROM ops.debug_clinic_day_number_writes
GROUP BY 1, 2, 3
ORDER BY write_count DESC;

COMMENT ON VIEW ops.v_debug_clinic_day_number_sources IS
'MIG_3051: Summary of distinct clinic_day_number writers. Query this after
running the trigger for ~1 week to identify all source paths.';

COMMIT;

\echo ''
\echo '=============================================='
\echo '  MIG_3051 Complete'
\echo '=============================================='
\echo ''
\echo 'Review after ~1 week:'
\echo '  SELECT * FROM ops.v_debug_clinic_day_number_sources;'
\echo ''
\echo 'Drop when done:'
\echo '  DROP TRIGGER trg_debug_clinic_day_number ON ops.appointments;'
\echo '  DROP FUNCTION ops.debug_log_clinic_day_number_write();'
\echo '  DROP TABLE ops.debug_clinic_day_number_writes CASCADE;'
\echo ''
