-- MIG_3049: find_or_create_appointment + ingest_skipped tracking
--
-- Part of FFS-1150 (Atlas Data Hardening), Initiative 2 (FFS-862).
--
-- Problem: Atlas has find_or_create_* functions for person/place/cat/request —
-- all idempotent upserts keyed by (source_system, source_record_id). But
-- appointments get direct INSERTs scattered across the ingest pipeline. Two
-- consequences:
--   (1) Ghost appointments — when `scripts/ingest-v2/lib/ops_layer.ts:46`
--       upserts by clinichq_appointment_id without requiring appointment_number
--       or client_name, NULL-named rows slip through.
--   (2) Silent data loss — when cat_info has a date/Number not in
--       appointment_info (the FFS-862 cancel/rebook case), the cat_info row
--       is effectively dropped. No row anywhere says "we saw this but
--       couldn't place it."
--
-- Solution:
--   1. ops.find_or_create_appointment() — the canonical idempotent upsert.
--      Conflict key is (source_system, source_record_id). Refuses ghost
--      signatures (no appointment_number AND no client_name) and orphan
--      references (missing date). Refusals route to ops.ingest_skipped.
--   2. ops.ingest_skipped — durable review queue for refused/orphan rows.
--   3. ops.detect_orphan_clinichq_cat_info_rows() — post-processing sweep
--      that logs cat_info rows whose (Number, Date) has no matching
--      appointment_info row for the same batch.
--
-- FFS-862 evidence: on 03/16/2026, 6 cats were booked, cancelled, and done
-- on 03/18. Only 03/18 appeared in appointment_info but cat_info had both
-- dates. The 03/16 cat_info rows silently vanished; clinic day 03/16 had
-- gaps at positions 31-37.
--
-- Created: 2026-04-06

\echo ''
\echo '=============================================='
\echo '  MIG_3049: find_or_create_appointment'
\echo '=============================================='
\echo ''

BEGIN;

-- ============================================================================
-- 1. ops.ingest_skipped — durable log of refused/orphan ingest rows
-- ============================================================================

\echo '1. Creating ops.ingest_skipped...'

CREATE TABLE IF NOT EXISTS ops.ingest_skipped (
  skipped_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_system     TEXT NOT NULL,
  source_table      TEXT,               -- e.g., 'cat_info', 'owner_info'
  source_record_id  TEXT,
  source_date       DATE,
  file_upload_id    UUID,               -- optional back-reference
  batch_id          UUID,               -- ClinicHQ 3-file batch
  payload           JSONB,              -- original row
  skip_reason       TEXT NOT NULL,      -- 'ghost_signature'|'orphan_reference'|'missing_date'|'missing_id'
  notes             TEXT,
  resolved_at       TIMESTAMPTZ,
  resolved_by       UUID,
  resolution        TEXT,               -- 'linked'|'force_created'|'dismissed'
  resolution_notes  TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ingest_skipped_unresolved
  ON ops.ingest_skipped (source_system, skip_reason, created_at DESC)
  WHERE resolved_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_ingest_skipped_batch
  ON ops.ingest_skipped (batch_id)
  WHERE batch_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ingest_skipped_source_date
  ON ops.ingest_skipped (source_date)
  WHERE source_date IS NOT NULL;

COMMENT ON TABLE ops.ingest_skipped IS
'MIG_3049: Review queue for ingest rows that were refused or could not be
placed. Examples: cancel/rebook cat_info rows whose date has no matching
appointment_info (FFS-862), appointment upserts lacking both appointment_number
and client_name. Surfaced in /admin/ingest/skipped.';

\echo '   Created ops.ingest_skipped'

-- ============================================================================
-- 2. ops.log_ingest_skip — thin writer used by other functions
-- ============================================================================

\echo ''
\echo '2. Creating ops.log_ingest_skip helper...'

CREATE OR REPLACE FUNCTION ops.log_ingest_skip(
  p_source_system    TEXT,
  p_source_table     TEXT,
  p_source_record_id TEXT,
  p_source_date      DATE,
  p_payload          JSONB,
  p_skip_reason      TEXT,
  p_notes            TEXT DEFAULT NULL,
  p_file_upload_id   UUID DEFAULT NULL,
  p_batch_id         UUID DEFAULT NULL
) RETURNS UUID AS $$
DECLARE
  v_skipped_id UUID;
BEGIN
  INSERT INTO ops.ingest_skipped (
    source_system, source_table, source_record_id, source_date, payload,
    skip_reason, notes, file_upload_id, batch_id
  ) VALUES (
    p_source_system, p_source_table, p_source_record_id, p_source_date, p_payload,
    p_skip_reason, p_notes, p_file_upload_id, p_batch_id
  )
  RETURNING skipped_id INTO v_skipped_id;

  RETURN v_skipped_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION ops.log_ingest_skip IS
'MIG_3049: Writes a row to ops.ingest_skipped. Use this from any ingest path
when a row cannot be placed into its target table.';

\echo '   Created ops.log_ingest_skip'

-- ============================================================================
-- 3. Unique index for the conflict key
-- ============================================================================
-- Without this, ON CONFLICT cannot be used. It's also the honest identity
-- of an ingested appointment.

\echo ''
\echo '3. Ensuring ops.appointments has (source_system, source_record_id) unique index...'

-- Historical data may have NULL source_record_id rows (legacy migrations).
-- Make the index partial so we can still enforce idempotency on new ingests
-- without breaking legacy data.
CREATE UNIQUE INDEX IF NOT EXISTS uq_appointments_source_system_record_id
  ON ops.appointments (source_system, source_record_id)
  WHERE source_record_id IS NOT NULL
    AND merged_into_appointment_id IS NULL;

\echo '   Ensured partial unique index on (source_system, source_record_id)'

-- ============================================================================
-- 4. ops.find_or_create_appointment — the canonical upsert
-- ============================================================================

\echo ''
\echo '4. Creating ops.find_or_create_appointment...'

CREATE OR REPLACE FUNCTION ops.find_or_create_appointment(
  p_source_system      TEXT,
  p_source_record_id   TEXT,
  p_appointment_date   DATE,
  p_appointment_number TEXT    DEFAULT NULL,
  p_cat_id             UUID    DEFAULT NULL,
  p_client_name        TEXT    DEFAULT NULL,
  p_person_id          UUID    DEFAULT NULL,
  p_owner_account_id   UUID    DEFAULT NULL,
  p_source_created_at  TIMESTAMPTZ DEFAULT NULL,
  p_raw_payload        JSONB   DEFAULT NULL,
  p_file_upload_id     UUID    DEFAULT NULL,
  p_batch_id           UUID    DEFAULT NULL
) RETURNS UUID AS $$
DECLARE
  v_appointment_id UUID;
  v_skip_reason    TEXT;
BEGIN
  -- Guard 1: source identity required
  IF p_source_system IS NULL OR p_source_record_id IS NULL THEN
    PERFORM ops.log_ingest_skip(
      COALESCE(p_source_system, 'unknown'),
      'appointment_info',
      p_source_record_id,
      p_appointment_date,
      p_raw_payload,
      'missing_id',
      'find_or_create_appointment called without source_system+source_record_id',
      p_file_upload_id,
      p_batch_id
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

  -- Guard 3: ghost signature
  -- A row with neither an appointment_number nor a client_name and no cat
  -- cannot be meaningfully identified. This is the FFS-862 signature.
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
  INSERT INTO ops.appointments AS a (
    source_system,
    source_record_id,
    source_created_at,
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
    p_source_created_at,
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
  RETURNING a.appointment_id INTO v_appointment_id;

  RETURN v_appointment_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION ops.find_or_create_appointment IS
'MIG_3049: The canonical idempotent upsert for ops.appointments.
Keyed by (source_system, source_record_id). Refuses ghost signatures
(no number AND no client_name AND no cat_id) and orphan references
(missing date or id). Refusals are logged to ops.ingest_skipped.
Honors MIG_3048 manually_overridden_fields on existing rows.
Use this function whenever you would otherwise write
INSERT INTO ops.appointments directly.';

\echo '   Created ops.find_or_create_appointment'

-- ============================================================================
-- 5. ops.detect_orphan_clinichq_cat_info_rows — batch-scoped sweep
-- ============================================================================
-- Called from run_clinichq_post_processing AFTER appointment_info has been
-- processed. Finds cat_info rows whose (Number, Date) pair has no matching
-- appointment_info row in the same batch and logs each one to ingest_skipped
-- with reason='orphan_reference'. This is the FFS-862 detection path.

\echo ''
\echo '5. Creating ops.detect_orphan_clinichq_cat_info_rows...'

CREATE OR REPLACE FUNCTION ops.detect_orphan_clinichq_cat_info_rows(
  p_file_upload_id UUID,
  p_batch_id       UUID DEFAULT NULL
) RETURNS INT AS $$
DECLARE
  v_logged INT := 0;
BEGIN
  WITH batch_appts AS (
    SELECT DISTINCT
      sr.payload->>'Number' AS number,
      sr.payload->>'Date'   AS date_text
    FROM ops.staged_records sr
    WHERE sr.source_system = 'clinichq'
      AND sr.source_table = 'appointment_info'
      AND (p_batch_id IS NULL OR sr.file_upload_id IN (
        SELECT upload_id FROM ops.file_uploads WHERE batch_id = p_batch_id
      ))
      AND (p_batch_id IS NOT NULL OR sr.file_upload_id = p_file_upload_id)
  ),
  orphan_cats AS (
    SELECT
      ci.source_row_id,
      ci.payload,
      ci.file_upload_id,
      ci.payload->>'Number' AS number,
      ci.payload->>'Date'   AS date_text
    FROM ops.staged_records ci
    WHERE ci.source_system = 'clinichq'
      AND ci.source_table = 'cat_info'
      AND ci.file_upload_id = p_file_upload_id
      AND ci.payload->>'Date' IS NOT NULL AND ci.payload->>'Date' != ''
      AND ci.payload->>'Number' IS NOT NULL AND ci.payload->>'Number' != ''
      AND NOT EXISTS (
        SELECT 1 FROM batch_appts ba
        WHERE ba.number = ci.payload->>'Number'
          AND ba.date_text = ci.payload->>'Date'
      )
      -- Don't re-log rows we've already flagged in this batch
      AND NOT EXISTS (
        SELECT 1 FROM ops.ingest_skipped is_existing
        WHERE is_existing.source_system = 'clinichq'
          AND is_existing.source_table = 'cat_info'
          AND is_existing.batch_id = p_batch_id
          AND is_existing.source_record_id = ci.source_row_id
          AND is_existing.skip_reason = 'orphan_reference'
      )
  ),
  logged AS (
    INSERT INTO ops.ingest_skipped (
      source_system, source_table, source_record_id, source_date,
      file_upload_id, batch_id, payload, skip_reason, notes
    )
    SELECT
      'clinichq',
      'cat_info',
      oc.source_row_id,
      CASE WHEN oc.date_text ~ '^\d{1,2}/\d{1,2}/\d{4}$'
           THEN TO_DATE(oc.date_text, 'MM/DD/YYYY')
           ELSE NULL
      END,
      oc.file_upload_id,
      p_batch_id,
      oc.payload,
      'orphan_reference',
      'cat_info row references (Number=' || oc.number ||
      ', Date=' || oc.date_text ||
      ') not present in appointment_info — likely cancel/rebook (FFS-862)'
    FROM orphan_cats oc
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_logged FROM logged;

  RETURN v_logged;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION ops.detect_orphan_clinichq_cat_info_rows IS
'MIG_3049: Detects cat_info rows whose (Number, Date) has no matching
appointment_info row in the same batch and logs them to ops.ingest_skipped
with reason=orphan_reference. Canonical FFS-862 case: a cat booked on day A
but rebooked to day B appears in cat_info for both days, but only day B
appears in appointment_info. Without this sweep, the day A row is silently
dropped and the 03/16 clinic day gets gaps at positions 31-37 (evidence from
the FFS-862 report).';

\echo '   Created ops.detect_orphan_clinichq_cat_info_rows'

-- ============================================================================
-- 6. View: unresolved orphans by batch/date
-- ============================================================================

\echo ''
\echo '6. Creating ops.v_ingest_skipped_unresolved...'

CREATE OR REPLACE VIEW ops.v_ingest_skipped_unresolved AS
SELECT
  skip_reason,
  source_system,
  source_table,
  COUNT(*)::INT               AS total,
  MIN(source_date)            AS earliest_source_date,
  MAX(source_date)            AS latest_source_date,
  MIN(created_at)             AS first_seen_at,
  MAX(created_at)             AS last_seen_at
FROM ops.ingest_skipped
WHERE resolved_at IS NULL
GROUP BY skip_reason, source_system, source_table
ORDER BY total DESC;

COMMENT ON VIEW ops.v_ingest_skipped_unresolved IS
'MIG_3049: Summary dashboard feed for /admin/ingest/skipped. Counts unresolved
rows by (reason, source_system, source_table).';

\echo '   Created ops.v_ingest_skipped_unresolved'

-- ============================================================================
-- 7. Verification
-- ============================================================================

\echo ''
\echo '7. Verification...'

-- Confirm table exists
SELECT COUNT(*) AS ingest_skipped_exists
FROM information_schema.tables
WHERE table_schema = 'ops' AND table_name = 'ingest_skipped';

-- Confirm functions exist
SELECT n.nspname || '.' || p.proname AS function_name
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'ops'
  AND p.proname IN (
    'find_or_create_appointment',
    'log_ingest_skip',
    'detect_orphan_clinichq_cat_info_rows'
  )
ORDER BY 1;

-- Smoke test: try to create a ghost — should refuse and return NULL
DO $$
DECLARE
  v_result UUID;
  v_skipped_count INT;
BEGIN
  v_result := ops.find_or_create_appointment(
    p_source_system      := 'test_mig_3049',
    p_source_record_id   := 'ghost_test_1',
    p_appointment_date   := '2026-04-06'::DATE,
    p_appointment_number := NULL,
    p_cat_id             := NULL,
    p_client_name        := NULL
  );

  IF v_result IS NOT NULL THEN
    RAISE EXCEPTION 'Ghost test failed: expected NULL, got %', v_result;
  END IF;

  SELECT COUNT(*) INTO v_skipped_count
  FROM ops.ingest_skipped
  WHERE source_system = 'test_mig_3049' AND skip_reason = 'ghost_signature';

  IF v_skipped_count = 0 THEN
    RAISE EXCEPTION 'Ghost test failed: no row logged to ingest_skipped';
  END IF;

  -- Cleanup test row
  DELETE FROM ops.ingest_skipped WHERE source_system = 'test_mig_3049';

  RAISE NOTICE '   Ghost signature refusal works correctly';
END;
$$;

COMMIT;

\echo ''
\echo '=============================================='
\echo '  MIG_3049 Complete'
\echo '=============================================='
\echo ''
\echo 'Changes:'
\echo '  1. Created ops.ingest_skipped table + indexes'
\echo '  2. Created ops.log_ingest_skip helper'
\echo '  3. Ensured partial unique (source_system, source_record_id) index'
\echo '  4. Created ops.find_or_create_appointment (canonical upsert)'
\echo '  5. Created ops.detect_orphan_clinichq_cat_info_rows (FFS-862 sweep)'
\echo '  6. Created ops.v_ingest_skipped_unresolved summary view'
\echo ''
\echo 'Next steps:'
\echo '  - Wire ops.detect_orphan_clinichq_cat_info_rows() into batch processing'
\echo '  - Build /admin/ingest/skipped review queue page'
\echo '  - Migrate scripts/ingest-v2/lib/ops_layer.ts upsertAppointment() to use'
\echo '    ops.find_or_create_appointment() (follow-up)'
\echo ''
