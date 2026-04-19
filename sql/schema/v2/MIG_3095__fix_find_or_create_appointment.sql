-- MIG_3095: Fix find_or_create_appointment — remove source_created_at reference
--
-- The function references ops.appointments.source_created_at which doesn't exist.
-- This causes the function to fail when called directly (e.g., manual data repair).
-- The function works during batch ingest only because the post-processing SQL
-- bypasses it for most paths.
--
-- Also fixes FFS-1294: ensures the date-suffix source_record_id pattern is
-- documented so future re-ingests don't overwrite cancelled-date records.
--
-- Created: 2026-04-19

\echo ''
\echo '=============================================='
\echo '  MIG_3095: Fix find_or_create_appointment'
\echo '=============================================='
\echo ''

BEGIN;

CREATE OR REPLACE FUNCTION ops.find_or_create_appointment(
  p_source_system      TEXT,
  p_source_record_id   TEXT,
  p_appointment_date   DATE,
  p_appointment_number TEXT DEFAULT NULL,
  p_cat_id             UUID DEFAULT NULL,
  p_client_name        TEXT DEFAULT NULL,
  p_person_id          UUID DEFAULT NULL,
  p_owner_account_id   UUID DEFAULT NULL,
  p_source_created_at  TIMESTAMPTZ DEFAULT NULL,  -- kept for signature compat
  p_raw_payload        JSONB DEFAULT NULL,
  p_file_upload_id     UUID DEFAULT NULL,
  p_batch_id           UUID DEFAULT NULL
) RETURNS UUID AS $$
DECLARE
  v_appointment_id UUID;
BEGIN
  -- Guard 1: source identity required
  IF p_source_system IS NULL OR p_source_record_id IS NULL THEN
    PERFORM ops.log_ingest_skip(
      COALESCE(p_source_system, 'unknown'),
      'appointment_info', p_source_record_id,
      p_appointment_date, p_raw_payload, 'missing_id',
      'find_or_create_appointment called without source_system+source_record_id',
      p_file_upload_id, p_batch_id
    );
    RETURN NULL;
  END IF;

  -- Guard 2: date required
  IF p_appointment_date IS NULL THEN
    PERFORM ops.log_ingest_skip(
      p_source_system, 'appointment_info', p_source_record_id,
      NULL, p_raw_payload, 'missing_date',
      'find_or_create_appointment called without appointment_date',
      p_file_upload_id, p_batch_id
    );
    RETURN NULL;
  END IF;

  -- Guard 3: ghost signature (FFS-862)
  IF p_appointment_number IS NULL
     AND p_client_name IS NULL
     AND p_cat_id IS NULL
  THEN
    PERFORM ops.log_ingest_skip(
      p_source_system, 'appointment_info', p_source_record_id,
      p_appointment_date, p_raw_payload, 'ghost_signature',
      'appointment has no number, no client_name, no cat_id — refusing to create',
      p_file_upload_id, p_batch_id
    );
    RETURN NULL;
  END IF;

  -- Idempotent upsert keyed by (source_system, source_record_id)
  -- FFS-1294: source_record_id includes date suffix (e.g., "26-986_3-16-2026")
  -- so the same appointment_number on different dates creates separate rows
  INSERT INTO ops.appointments AS a (
    source_system,
    source_record_id,
    appointment_date,
    appointment_number,
    cat_id,
    client_name,
    person_id,
    owner_account_id,
    owner_raw_payload,
    created_at,
    updated_at
  ) VALUES (
    p_source_system,
    p_source_record_id,
    p_appointment_date,
    p_appointment_number,
    p_cat_id,
    p_client_name,
    p_person_id,
    p_owner_account_id,
    p_raw_payload,
    NOW(),
    NOW()
  )
  ON CONFLICT (source_system, source_record_id)
    WHERE source_record_id IS NOT NULL
      AND merged_into_appointment_id IS NULL
  DO UPDATE SET
    -- MIG_3048: honor manually_overridden_fields on the winner
    appointment_date = CASE
      WHEN ops.is_field_manually_set(a.manually_overridden_fields, 'appointment_date')
      THEN a.appointment_date
      ELSE COALESCE(EXCLUDED.appointment_date, a.appointment_date)
    END,
    appointment_number = COALESCE(
      CASE WHEN ops.is_field_manually_set(a.manually_overridden_fields, 'appointment_number')
           THEN a.appointment_number
           ELSE EXCLUDED.appointment_number END,
      a.appointment_number
    ),
    cat_id = CASE
      WHEN ops.is_field_manually_set(a.manually_overridden_fields, 'cat_id')
      THEN a.cat_id
      ELSE COALESCE(EXCLUDED.cat_id, a.cat_id)
    END,
    client_name = CASE
      WHEN ops.is_field_manually_set(a.manually_overridden_fields, 'client_name')
      THEN a.client_name
      ELSE COALESCE(EXCLUDED.client_name, a.client_name)
    END,
    person_id = COALESCE(a.person_id, EXCLUDED.person_id),
    owner_account_id = COALESCE(a.owner_account_id, EXCLUDED.owner_account_id),
    owner_raw_payload = COALESCE(EXCLUDED.owner_raw_payload, a.owner_raw_payload),
    updated_at = NOW()
  RETURNING a.appointment_id
  INTO v_appointment_id;

  RETURN v_appointment_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION ops.find_or_create_appointment IS
  'Idempotent appointment creation. Dedup key: (source_system, source_record_id). '
  'FFS-1294: source_record_id includes date suffix to preserve cancelled-date records. '
  'MIG_3048: honors manually_overridden_fields on upsert. '
  'MIG_3095: removed reference to non-existent source_created_at column.';

\echo '✓ find_or_create_appointment fixed'

COMMIT;
