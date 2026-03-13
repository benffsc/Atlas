-- MIG_2927: Airtable Sync Engine — DB Schema (FFS-504)
--
-- Config-driven infrastructure for Airtable syncs.
-- New syncs require only a DB row — no code changes.
--
-- Tables:
--   ops.airtable_sync_configs  — Defines what/how to sync
--   ops.airtable_sync_runs     — Audit log of every run
--
-- Seed data:
--   trapper-agreement  — Full person_onboarding config (replaces hardcoded route)
--   intake-submissions — Registry entry for legacy route (observability only)

BEGIN;

-- ============================================================================
-- 1. SYNC CONFIGS
-- ============================================================================

CREATE TABLE IF NOT EXISTS ops.airtable_sync_configs (
  config_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT UNIQUE NOT NULL,
  description TEXT,

  -- Airtable source
  airtable_base_id TEXT NOT NULL,
  airtable_table_name TEXT NOT NULL,
  filter_formula TEXT NOT NULL DEFAULT 'OR({Sync Status}=''pending'', {Sync Status}=''error'', {Sync Status}=BLANK())',
  page_size INTEGER NOT NULL DEFAULT 100,

  -- Field mapping: Airtable field name → { maps_to, required?, transform?, default_value? }
  field_mappings JSONB NOT NULL,

  -- Pipeline dispatch
  pipeline TEXT NOT NULL CHECK (pipeline IN ('person_onboarding', 'data_import', 'custom')),
  pipeline_config JSONB NOT NULL DEFAULT '{}',

  -- Writeback: how to update Airtable after processing
  writeback_config JSONB NOT NULL,

  -- Scheduling
  schedule_cron TEXT,              -- NULL = webhook/manual only
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  is_legacy BOOLEAN NOT NULL DEFAULT FALSE,

  -- Guardrails
  max_records_per_run INTEGER NOT NULL DEFAULT 100,
  max_duration_seconds INTEGER NOT NULL DEFAULT 60,

  -- Tracking (updated by engine after each run)
  last_sync_at TIMESTAMPTZ,
  last_sync_status TEXT,
  last_sync_count INTEGER NOT NULL DEFAULT 0,

  -- Audit
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE ops.airtable_sync_configs IS
'Config-driven Airtable sync definitions. Each row defines a complete sync:
source (base/table/filter), field mapping, processing pipeline, and writeback.';

-- ============================================================================
-- 2. SYNC RUNS (audit log)
-- ============================================================================

CREATE TABLE IF NOT EXISTS ops.airtable_sync_runs (
  run_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  config_id UUID NOT NULL REFERENCES ops.airtable_sync_configs(config_id),
  config_name TEXT NOT NULL,

  trigger_type TEXT NOT NULL CHECK (trigger_type IN ('cron', 'webhook', 'manual')),
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,

  -- Counters
  records_found INTEGER NOT NULL DEFAULT 0,
  records_synced INTEGER NOT NULL DEFAULT 0,
  records_errored INTEGER NOT NULL DEFAULT 0,

  -- Details
  results JSONB NOT NULL DEFAULT '[]',
  duration_ms INTEGER,
  error_summary TEXT              -- top-level error if entire run fails
);

CREATE INDEX IF NOT EXISTS idx_sync_runs_config_started
  ON ops.airtable_sync_runs (config_id, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_sync_runs_started
  ON ops.airtable_sync_runs (started_at DESC);

COMMENT ON TABLE ops.airtable_sync_runs IS
'Audit log of every Airtable sync execution. One row per run, with per-record results in JSONB.';

-- ============================================================================
-- 3. SEED DATA
-- ============================================================================

-- 3a. Trapper Agreement sync — full person_onboarding config
--     Matches current hardcoded route (trapper-agreement-sync/route.ts) exactly.

INSERT INTO ops.airtable_sync_configs (
  name, description,
  airtable_base_id, airtable_table_name,
  filter_formula, page_size,
  field_mappings,
  pipeline, pipeline_config,
  writeback_config,
  schedule_cron, is_active, is_legacy,
  max_records_per_run, max_duration_seconds
) VALUES (
  'trapper-agreement',
  'Community Trapper Agreement sync from JotForm → Airtable → Atlas. Resolves identity, creates trapper role + profile.',
  'appwFuRddph1krmcd',
  'Community Trapper Agreements',
  'OR({Sync Status}=''pending'', {Sync Status}=''error'', {Sync Status}=BLANK())',
  100,

  -- field_mappings: Airtable field → { maps_to, required?, transform? }
  '{
    "first_name": { "maps_to": "first_name", "required": true, "transform": "trim" },
    "last_name":  { "maps_to": "last_name",  "required": true, "transform": "trim" },
    "Email":      { "maps_to": "email",      "required": true, "transform": "lowercase_trim" },
    "Phone":      { "maps_to": "phone",      "required": false, "transform": "trim" },
    "address":    { "maps_to": "address",     "required": false, "transform": "trim" },
    "availability": { "maps_to": "availability", "required": false, "transform": "trim" },
    "Signature":  { "maps_to": "has_signature",  "required": false, "transform": "boolean" }
  }'::jsonb,

  'person_onboarding',

  -- pipeline_config: how the person_onboarding pipeline processes each record
  '{
    "source_system": "atlas_sync",
    "identity_fields": {
      "email": "email",
      "phone": "phone",
      "first_name": "first_name",
      "last_name": "last_name",
      "address": "address"
    },
    "validation_rules": {
      "email": { "required": true, "must_contain": "@" }
    },
    "post_steps": [
      {
        "type": "add_role",
        "role": "trapper",
        "source_system": "atlas_sync"
      },
      {
        "type": "upsert_profile",
        "table": "sot.trapper_profiles",
        "conflict_column": "person_id",
        "columns": {
          "person_id": "$person_id",
          "trapper_type": "community_trapper",
          "is_active": true,
          "has_signed_contract": "$has_signature",
          "contract_signed_date": { "transform": "date_today_if_truthy", "source": "has_signature" },
          "contract_areas": null,
          "notes": { "template": "Availability: ${availability}" },
          "source_system": "atlas_sync"
        },
        "on_conflict_update": {
          "has_signed_contract": "EXCLUDED.has_signed_contract OR sot.trapper_profiles.has_signed_contract",
          "contract_signed_date": "COALESCE(EXCLUDED.contract_signed_date, sot.trapper_profiles.contract_signed_date)",
          "notes": "CASE WHEN sot.trapper_profiles.notes IS NULL THEN EXCLUDED.notes WHEN EXCLUDED.notes IS NULL THEN sot.trapper_profiles.notes ELSE sot.trapper_profiles.notes || E''\\n[Agreement Sync] '' || EXCLUDED.notes END",
          "updated_at": "NOW()"
        }
      },
      {
        "type": "audit_trail",
        "entity_type": "person",
        "edit_type": "create",
        "field_name": "trapper_onboarding",
        "edit_source": "trapper-agreement-sync",
        "reason": "Community trapper agreement synced from Airtable",
        "new_value_fields": ["email", "match_type", "has_signature", "availability"]
      }
    ],
    "entity_id_type": "person_id"
  }'::jsonb,

  -- writeback_config
  '{
    "status_field": "Sync Status",
    "error_field": "Sync Error",
    "entity_id_field": "Atlas Person ID",
    "synced_at_field": "Synced At",
    "success_status": "synced",
    "error_status": "error"
  }'::jsonb,

  '*/30 * * * *',   -- every 30 minutes
  TRUE,
  FALSE,
  100,
  60
)
ON CONFLICT (name) DO NOTHING;


-- 3b. Intake Submissions sync — registry entry for legacy route
--     The old route (/api/cron/airtable-sync) still handles this.
--     Config exists for observability and future migration.

INSERT INTO ops.airtable_sync_configs (
  name, description,
  airtable_base_id, airtable_table_name,
  field_mappings,
  pipeline, pipeline_config,
  writeback_config,
  schedule_cron, is_active, is_legacy,
  max_records_per_run, max_duration_seconds
) VALUES (
  'intake-submissions',
  'Public Intake Submissions sync from JotForm → Airtable → Atlas. Legacy route handles processing.',
  'appwFuRddph1krmcd',
  'Public Intake Submissions',
  '{}'::jsonb,             -- Not used by engine (legacy)
  'custom',
  '{}'::jsonb,
  '{
    "status_field": "Sync Status",
    "error_field": "Sync Error",
    "entity_id_field": "Atlas Submission ID",
    "synced_at_field": "Synced At",
    "success_status": "synced",
    "error_status": "error"
  }'::jsonb,
  '*/30 * * * *',
  TRUE,
  TRUE,                    -- is_legacy = TRUE → engine skips this
  100,
  120
)
ON CONFLICT (name) DO NOTHING;

COMMIT;
