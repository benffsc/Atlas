-- MIG_2928: Airtable Sync Records — per-record audit trail (FFS-504)
--
-- Every record that comes through the sync engine gets logged here,
-- regardless of outcome (synced, rejected, error). Airtable is just
-- a pass-through from JotForm — the DB is the single source of truth.

BEGIN;

CREATE TABLE IF NOT EXISTS ops.airtable_sync_records (
  record_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  config_id UUID NOT NULL REFERENCES ops.airtable_sync_configs(config_id),
  config_name TEXT NOT NULL,
  run_id UUID REFERENCES ops.airtable_sync_runs(run_id),

  -- Airtable source
  airtable_record_id TEXT NOT NULL,

  -- What came in (raw from Airtable) and what we mapped it to
  raw_fields JSONB NOT NULL DEFAULT '{}',
  mapped_fields JSONB NOT NULL DEFAULT '{}',

  -- Outcome
  status TEXT NOT NULL CHECK (status IN ('synced', 'rejected', 'error')),
  entity_id UUID,                      -- resolved person/entity ID if synced
  match_type TEXT,                     -- decision_type from identity resolution

  -- Why it failed (if it did)
  rejection_reason TEXT,               -- e.g. "Failed should_be_person gate"
  error_message TEXT,                  -- full error for errors

  -- Identity resolution details (always logged when called)
  identity_result JSONB,               -- full response from data_engine_resolve_identity

  -- Timestamps
  processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Archive support: confirmed junk can be archived to keep audit queue clean
  archived_at TIMESTAMPTZ,
  archived_by UUID                     -- staff who archived it (nullable)
);

CREATE INDEX IF NOT EXISTS idx_sync_records_config
  ON ops.airtable_sync_records (config_id, processed_at DESC);

CREATE INDEX IF NOT EXISTS idx_sync_records_airtable
  ON ops.airtable_sync_records (airtable_record_id);

CREATE INDEX IF NOT EXISTS idx_sync_records_status
  ON ops.airtable_sync_records (status, processed_at DESC);

COMMENT ON TABLE ops.airtable_sync_records IS
'Per-record audit trail for every Airtable sync. Logs raw input, mapped fields,
identity resolution result, and outcome — regardless of success or failure.
Airtable is just a JotForm pass-through; this table is the single source of truth.';

COMMIT;
