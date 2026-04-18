-- MIG_3091: CDS Audit Events — Chronological data change tracking
--
-- Part of FFS-1236 (CDS: Chronological data change audit trail)
--
-- Problem: When data changes between CDS runs (appointments merged, cats
-- renamed, new batches uploaded), there's no audit trail. CDS can't tell
-- what changed since last run or whether changes invalidate matches.
--
-- Solution: ops.cds_audit_events table + triggers on key tables that
-- automatically log CDS-relevant changes. CDS reads "any events since
-- my last run for this date?" to detect what needs re-processing.
--
-- Depends on: MIG_3052 (ops.cds_runs)
--
-- Created: 2026-04-18

\echo ''
\echo '=============================================='
\echo '  MIG_3091: CDS Audit Events'
\echo '=============================================='
\echo ''

BEGIN;

-- ============================================================================
-- 1. Audit events table
-- ============================================================================

\echo '1. Creating ops.cds_audit_events...'

CREATE TABLE IF NOT EXISTS ops.cds_audit_events (
  event_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_date  DATE NOT NULL,
  event_type   TEXT NOT NULL,      -- appointment_merged, cat_renamed, batch_uploaded,
                                   -- waiver_matched, entry_imported, cdn_changed,
                                   -- match_cleared, match_set
  entity_type  TEXT,               -- appointment, cat, waiver, entry
  entity_id    TEXT,               -- UUID as text for flexibility
  old_value    JSONB,
  new_value    JSONB,
  source       TEXT,               -- batch_upload, merge_cron, manual_edit, cds_run,
                                   -- waiver_sync, master_list_sync
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cds_audit_events_date
  ON ops.cds_audit_events(clinic_date, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_cds_audit_events_type
  ON ops.cds_audit_events(event_type);

COMMENT ON TABLE ops.cds_audit_events IS
  'Tracks data changes relevant to CDS matching. CDS queries this to detect '
  'what changed since last run. Triggers on appointments, cats, and entries '
  'auto-populate. Used by FFS-1235 (delta re-matching).';

-- ============================================================================
-- 2. Trigger: appointment merged
-- ============================================================================

\echo ''
\echo '2. Creating appointment merge audit trigger...'

CREATE OR REPLACE FUNCTION ops.trg_cds_audit_appointment_merge()
RETURNS TRIGGER AS $$
BEGIN
  -- Only fire when merged_into_appointment_id changes from NULL to a value
  IF OLD.merged_into_appointment_id IS NULL AND NEW.merged_into_appointment_id IS NOT NULL THEN
    INSERT INTO ops.cds_audit_events (
      clinic_date, event_type, entity_type, entity_id,
      old_value, new_value, source
    ) VALUES (
      NEW.appointment_date,
      'appointment_merged',
      'appointment',
      NEW.appointment_id::text,
      jsonb_build_object(
        'clinic_day_number', OLD.clinic_day_number,
        'cat_id', OLD.cat_id,
        'client_name', OLD.client_name
      ),
      jsonb_build_object('merged_into', NEW.merged_into_appointment_id),
      'merge'
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_cds_audit_appointment_merge ON ops.appointments;
CREATE TRIGGER trg_cds_audit_appointment_merge
  AFTER UPDATE OF merged_into_appointment_id ON ops.appointments
  FOR EACH ROW
  EXECUTE FUNCTION ops.trg_cds_audit_appointment_merge();

-- ============================================================================
-- 3. Trigger: clinic_day_number changed
-- ============================================================================

\echo '3. Creating CDN change audit trigger...'

CREATE OR REPLACE FUNCTION ops.trg_cds_audit_cdn_change()
RETURNS TRIGGER AS $$
BEGIN
  -- Only fire when clinic_day_number actually changes
  IF OLD.clinic_day_number IS DISTINCT FROM NEW.clinic_day_number THEN
    INSERT INTO ops.cds_audit_events (
      clinic_date, event_type, entity_type, entity_id,
      old_value, new_value, source
    ) VALUES (
      NEW.appointment_date,
      'cdn_changed',
      'appointment',
      NEW.appointment_id::text,
      jsonb_build_object('clinic_day_number', OLD.clinic_day_number, 'source', OLD.clinic_day_number_source),
      jsonb_build_object('clinic_day_number', NEW.clinic_day_number, 'source', NEW.clinic_day_number_source),
      COALESCE(NEW.clinic_day_number_source::text, 'unknown')
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_cds_audit_cdn_change ON ops.appointments;
CREATE TRIGGER trg_cds_audit_cdn_change
  AFTER UPDATE OF clinic_day_number ON ops.appointments
  FOR EACH ROW
  EXECUTE FUNCTION ops.trg_cds_audit_cdn_change();

-- ============================================================================
-- 4. Trigger: entry match changed
-- ============================================================================

\echo '4. Creating entry match change audit trigger...'

CREATE OR REPLACE FUNCTION ops.trg_cds_audit_entry_match()
RETURNS TRIGGER AS $$
BEGIN
  -- Only fire when matched_appointment_id changes
  IF OLD.matched_appointment_id IS DISTINCT FROM NEW.matched_appointment_id THEN
    INSERT INTO ops.cds_audit_events (
      clinic_date, event_type, entity_type, entity_id,
      old_value, new_value, source
    ) VALUES (
      (SELECT cd.clinic_date FROM ops.clinic_days cd WHERE cd.clinic_day_id = NEW.clinic_day_id),
      CASE
        WHEN OLD.matched_appointment_id IS NULL AND NEW.matched_appointment_id IS NOT NULL THEN 'match_set'
        WHEN OLD.matched_appointment_id IS NOT NULL AND NEW.matched_appointment_id IS NULL THEN 'match_cleared'
        ELSE 'match_changed'
      END,
      'entry',
      NEW.entry_id::text,
      jsonb_build_object(
        'appointment_id', OLD.matched_appointment_id,
        'method', OLD.cds_method,
        'confidence', OLD.match_confidence
      ),
      jsonb_build_object(
        'appointment_id', NEW.matched_appointment_id,
        'method', NEW.cds_method,
        'confidence', NEW.match_confidence
      ),
      COALESCE(NEW.cds_method, 'unknown')
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_cds_audit_entry_match ON ops.clinic_day_entries;
CREATE TRIGGER trg_cds_audit_entry_match
  AFTER UPDATE OF matched_appointment_id ON ops.clinic_day_entries
  FOR EACH ROW
  EXECUTE FUNCTION ops.trg_cds_audit_entry_match();

-- ============================================================================
-- 5. Helper: get changes since last CDS run for a date
-- ============================================================================

\echo ''
\echo '5. Creating ops.cds_changes_since_last_run...'

CREATE OR REPLACE FUNCTION ops.cds_changes_since_last_run(p_clinic_date DATE)
RETURNS TABLE (
  event_count BIGINT,
  event_types TEXT[],
  latest_event TIMESTAMPTZ,
  events JSONB
) AS $$
DECLARE
  v_last_run TIMESTAMPTZ;
BEGIN
  -- Find when last CDS run completed for this date
  SELECT completed_at INTO v_last_run
  FROM ops.cds_runs
  WHERE clinic_date = p_clinic_date
    AND completed_at IS NOT NULL
  ORDER BY completed_at DESC
  LIMIT 1;

  -- If no prior run, return all events
  IF v_last_run IS NULL THEN
    v_last_run := '1970-01-01'::TIMESTAMPTZ;
  END IF;

  RETURN QUERY
  SELECT
    COUNT(*)::BIGINT,
    ARRAY_AGG(DISTINCT e.event_type),
    MAX(e.created_at),
    jsonb_agg(jsonb_build_object(
      'event_type', e.event_type,
      'entity_type', e.entity_type,
      'entity_id', e.entity_id,
      'source', e.source,
      'created_at', e.created_at
    ) ORDER BY e.created_at DESC)
  FROM ops.cds_audit_events e
  WHERE e.clinic_date = p_clinic_date
    AND e.created_at > v_last_run;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION ops.cds_changes_since_last_run IS
  'Returns CDS-relevant data changes since the last completed CDS run for a date. '
  'Used by delta re-matching (FFS-1235) to determine what needs re-processing.';

-- ============================================================================
-- 6. Verification
-- ============================================================================

\echo ''
\echo '6. Verification...'

DO $$
DECLARE
  v_table_exists BOOLEAN;
  v_trigger_count INT;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'ops' AND table_name = 'cds_audit_events'
  ) INTO v_table_exists;
  ASSERT v_table_exists, 'cds_audit_events table not found';

  SELECT COUNT(*) INTO v_trigger_count
  FROM information_schema.triggers
  WHERE trigger_schema = 'ops'
    AND trigger_name LIKE 'trg_cds_audit_%';
  ASSERT v_trigger_count >= 3, format('Expected >= 3 audit triggers, found %s', v_trigger_count);

  RAISE NOTICE '   ✓ Table + % triggers created', v_trigger_count;
END;
$$;

COMMIT;

\echo ''
\echo '✓ MIG_3091 complete'
\echo ''
