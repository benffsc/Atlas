-- MIG_3053: Source Payload Extraction Registry
--
-- Part of FFS-1150 (Atlas Data Hardening), Initiative 5 (FFS-1154).
--
-- Problem: Today (2026-04-06) we discovered ShelterLuv `PreviousIds`
-- contained 1476 SCAS IDs — a critical bridge between Atlas cats and the
-- external SCAS system — buried in source.shelterluv_raw.payload and
-- invisible until MIG_3047 backfilled them.
--
-- We have no systematic way to know what JSONB keys exist in source
-- payloads that we haven't promoted to typed columns yet. Every surprise
-- like `PreviousIds` is an integration bug waiting to happen.
--
-- Pattern: Auto-discovery + explicit registry (Bronze layer → Silver
-- layer promotion tracking). The registry says "we know about this key";
-- the auto-discovery view says "here's everything else."
--
-- Created: 2026-04-06

\echo ''
\echo '=============================================='
\echo '  MIG_3053: Source Extraction Registry'
\echo '=============================================='
\echo ''

BEGIN;

-- ============================================================================
-- 1. Registry table
-- ============================================================================

\echo '1. Creating ops.source_extraction_registry...'

CREATE TABLE IF NOT EXISTS ops.source_extraction_registry (
  registry_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_table       TEXT NOT NULL,
  payload_key        TEXT NOT NULL,
  extracted_to_table TEXT,
  extracted_to_column TEXT,
  extraction_method  TEXT,            -- 'migration'|'trigger'|'view'|'ingest_pipeline'|'NA'
  extraction_migration TEXT,          -- e.g., 'MIG_3047'
  status             TEXT NOT NULL CHECK (status IN ('extracted','ignored','pending_review')),
  last_seen_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sample_value       TEXT,
  notes              TEXT,
  reviewed_by        UUID,
  reviewed_at        TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (source_table, payload_key)
);

CREATE INDEX IF NOT EXISTS idx_extraction_registry_status
  ON ops.source_extraction_registry (status, source_table)
  WHERE status = 'pending_review';

CREATE INDEX IF NOT EXISTS idx_extraction_registry_source
  ON ops.source_extraction_registry (source_table);

COMMENT ON TABLE ops.source_extraction_registry IS
'MIG_3053: Catalog of which JSONB payload keys we have promoted to typed
columns vs ignored vs still pending review. Used together with
ops.v_unextracted_payload_keys to detect new keys appearing in source
systems before they cause silent data loss.';

\echo '   Created registry table'

-- ============================================================================
-- 2. Auto-discovery view
-- ============================================================================
-- Lists all distinct JSONB keys across known source.*_raw tables that are
-- NOT marked extracted/ignored in the registry. New keys land here for
-- triage. The query is bounded to recent rows only for performance.

\echo ''
\echo '2. Creating ops.v_unextracted_payload_keys view...'

CREATE OR REPLACE VIEW ops.v_unextracted_payload_keys AS
WITH discovered AS (
  SELECT
    'source.clinichq_raw'   AS source_table,
    jsonb_object_keys(payload) AS payload_key
  FROM source.clinichq_raw
  WHERE fetched_at >= NOW() - INTERVAL '180 days'
  UNION
  SELECT
    'source.shelterluv_raw',
    jsonb_object_keys(payload)
  FROM source.shelterluv_raw
  WHERE fetched_at >= NOW() - INTERVAL '180 days'
  UNION
  SELECT
    'source.volunteerhub_raw',
    jsonb_object_keys(payload)
  FROM source.volunteerhub_raw
  WHERE fetched_at >= NOW() - INTERVAL '180 days'
  UNION
  SELECT
    'source.airtable_raw',
    jsonb_object_keys(payload)
  FROM source.airtable_raw
  WHERE fetched_at >= NOW() - INTERVAL '180 days'
  UNION
  SELECT
    'source.petlink_raw',
    jsonb_object_keys(payload)
  FROM source.petlink_raw
  WHERE fetched_at >= NOW() - INTERVAL '180 days'
  UNION
  SELECT
    'source.web_intake_raw',
    jsonb_object_keys(payload)
  FROM source.web_intake_raw
  WHERE submitted_at >= NOW() - INTERVAL '180 days'
  UNION
  SELECT
    'source.linear_raw',
    jsonb_object_keys(payload)
  FROM source.linear_raw
  WHERE fetched_at >= NOW() - INTERVAL '180 days'
)
SELECT DISTINCT
  d.source_table,
  d.payload_key,
  COALESCE(r.status, 'unregistered') AS status
FROM discovered d
LEFT JOIN ops.source_extraction_registry r
  ON r.source_table = d.source_table
 AND r.payload_key = d.payload_key
WHERE r.registry_id IS NULL OR r.status = 'pending_review'
ORDER BY d.source_table, d.payload_key;

COMMENT ON VIEW ops.v_unextracted_payload_keys IS
'MIG_3053: Lists JSONB keys discovered in the last 30 days of source.*_raw
tables that are NOT marked extracted/ignored in
ops.source_extraction_registry. New rows here mean a source system added
a field — promote it or mark it ignored.';

\echo '   Created view'

-- ============================================================================
-- 3. Discovery refresh — populates registry with newly-seen keys
-- ============================================================================
-- Use this from a cron job to upsert any new keys as 'pending_review'.

\echo ''
\echo '3. Creating ops.refresh_extraction_registry()...'

CREATE OR REPLACE FUNCTION ops.refresh_extraction_registry()
RETURNS TABLE(new_keys INT, pending_total INT) AS $$
DECLARE
  v_new INT := 0;
  v_total INT := 0;
BEGIN
  WITH inserted AS (
    INSERT INTO ops.source_extraction_registry (
      source_table, payload_key, status, notes
    )
    SELECT
      v.source_table,
      v.payload_key,
      'pending_review',
      'Auto-discovered by refresh_extraction_registry'
    FROM ops.v_unextracted_payload_keys v
    WHERE v.status = 'unregistered'
    ON CONFLICT (source_table, payload_key) DO UPDATE
      SET last_seen_at = NOW()
    RETURNING (xmax = 0) AS is_new
  )
  SELECT COUNT(*) FILTER (WHERE is_new)::INT INTO v_new FROM inserted;

  SELECT COUNT(*)::INT INTO v_total
  FROM ops.source_extraction_registry
  WHERE status = 'pending_review';

  RETURN QUERY SELECT v_new, v_total;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION ops.refresh_extraction_registry IS
'MIG_3053: Upserts newly-seen payload keys into the registry as
pending_review. Run on a cron schedule to alert when source systems add
fields. Returns (new_keys_added, total_pending).';

\echo '   Created refresh function'

-- ============================================================================
-- 4. Backfill — seed the registry with what we already know is extracted
-- ============================================================================
-- These are documented in CLAUDE.md / migration history. Mark them
-- 'extracted' so they drop out of the unextracted view.

\echo ''
\echo '4. Backfilling known-extracted keys...'

INSERT INTO ops.source_extraction_registry (
  source_table, payload_key, extracted_to_table, extracted_to_column,
  extraction_method, extraction_migration, status, notes
) VALUES
  -- ClinicHQ appointment_info
  ('source.clinichq_raw', 'Number',           'ops.appointments',  'appointment_number', 'ingest_pipeline', 'MIG_2975', 'extracted', 'ClinicHQ appointment number'),
  ('source.clinichq_raw', 'Date',             'ops.appointments',  'appointment_date',   'ingest_pipeline', 'MIG_2975', 'extracted', 'ClinicHQ appointment date'),
  ('source.clinichq_raw', 'Microchip Number', 'sot.cat_identifiers','id_value',          'ingest_pipeline', 'MIG_2975', 'extracted', 'Cat microchip'),
  ('source.clinichq_raw', 'Animal Name',      'sot.cats',          'name',               'ingest_pipeline', 'MIG_2975', 'extracted', 'Cat name (also recheck pattern source for embedded chips)'),
  ('source.clinichq_raw', 'Sex',              'sot.cats',          'sex',                'ingest_pipeline', 'MIG_2975', 'extracted', 'Cat sex'),
  ('source.clinichq_raw', 'Breed',            'sot.cats',          'breed',              'ingest_pipeline', 'MIG_2975', 'extracted', 'Cat breed'),
  ('source.clinichq_raw', 'Primary Color',    'sot.cats',          'primary_color',      'ingest_pipeline', 'MIG_2975', 'extracted', 'Cat primary color'),
  ('source.clinichq_raw', 'Secondary Color',  'sot.cats',          'secondary_color',    'ingest_pipeline', 'MIG_2975', 'extracted', 'Cat secondary color'),
  ('source.clinichq_raw', 'Owner First Name', 'ops.clinic_accounts','first_name',        'ingest_pipeline', 'MIG_2975', 'extracted', 'Owner first name (also place extraction source — DATA_GAP_054)'),
  ('source.clinichq_raw', 'Owner Last Name',  'ops.clinic_accounts','last_name',         'ingest_pipeline', 'MIG_2975', 'extracted', 'Owner last name'),
  ('source.clinichq_raw', 'Owner Email',      'sot.person_identifiers','id_value_norm',  'ingest_pipeline', 'MIG_2975', 'extracted', 'Owner email (high-confidence identifier)'),
  ('source.clinichq_raw', 'Owner Phone',      'sot.person_identifiers','id_value_norm',  'ingest_pipeline', 'MIG_2975', 'extracted', 'Owner phone (preferred over Cell Phone)'),
  ('source.clinichq_raw', 'Owner Cell Phone', 'sot.person_identifiers','id_value_norm',  'ingest_pipeline', 'MIG_2975', 'extracted', 'Owner cell phone (fallback when Owner Phone is empty)'),

  -- ShelterLuv
  ('source.shelterluv_raw', 'PreviousIds',         'sot.cat_identifiers', 'id_value_norm', 'migration',       'MIG_3047', 'extracted', 'SCAS bridge IDs — backfilled 1476 cats. The 2026-04-06 surprise.'),
  ('source.shelterluv_raw', 'Internal-ID',         'sot.cat_identifiers', 'id_value_norm', 'ingest_pipeline', 'MIG_2026', 'extracted', 'ShelterLuv animal ID'),
  ('source.shelterluv_raw', 'Microchip Number',    'sot.cat_identifiers', 'id_value_norm', 'ingest_pipeline', 'MIG_2026', 'extracted', 'Microchip'),
  ('source.shelterluv_raw', 'Name',                'sot.cats',            'name',           'ingest_pipeline', 'MIG_2026', 'extracted', 'Cat name'),

  -- Common noise / metadata fields → ignored
  ('source.clinichq_raw',   '_meta',          NULL, NULL, 'NA', NULL, 'ignored', 'Internal metadata, not data'),
  ('source.shelterluv_raw', '_meta',          NULL, NULL, 'NA', NULL, 'ignored', 'Internal metadata, not data')
ON CONFLICT (source_table, payload_key) DO NOTHING;

\echo '   Backfilled known-extracted keys'

-- ============================================================================
-- 5. Initial discovery sweep
-- ============================================================================

\echo ''
\echo '5. Running initial discovery sweep...'

SELECT * FROM ops.refresh_extraction_registry();

-- Show a sample of what landed in pending_review
SELECT source_table, COUNT(*) AS pending_keys
FROM ops.source_extraction_registry
WHERE status = 'pending_review'
GROUP BY source_table
ORDER BY 2 DESC;

COMMIT;

\echo ''
\echo '=============================================='
\echo '  MIG_3053 Complete'
\echo '=============================================='
\echo ''
\echo 'Changes:'
\echo '  1. Created ops.source_extraction_registry table'
\echo '  2. Created ops.v_unextracted_payload_keys auto-discovery view'
\echo '  3. Created ops.refresh_extraction_registry() upsert function'
\echo '  4. Backfilled 19 known-extracted ClinicHQ + ShelterLuv keys'
\echo '  5. Ran initial discovery sweep (rest land as pending_review)'
\echo ''
\echo 'Next steps:'
\echo '  - Review pending_review entries: SELECT * FROM ops.source_extraction_registry WHERE status=''pending_review'''
\echo '  - Wire ops.refresh_extraction_registry() into a weekly cron'
\echo '  - Slack alert on new pending_review entries (extend MIG_3050 cron)'
\echo ''
