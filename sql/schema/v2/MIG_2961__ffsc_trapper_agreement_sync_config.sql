-- MIG_2961: FFSC Trapper Agreement Sync Config
--
-- Adds config for FFSC trapper agreements (Tier 1 — completed orientation).
-- Same field schema as Community Trapper Agreements, different table + trapper_type.
--
-- Webhook: POST /api/webhooks/airtable-sync?config=ffsc-trapper-agreement

BEGIN;

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
  'ffsc-trapper-agreement',
  'FFSC Trapper Agreement sync (Tier 1 — post-orientation). Resolves identity, creates trapper role + ffsc_volunteer profile.',
  'appwFuRddph1krmcd',
  'FFSC Trapper Agreements',
  'OR({Sync Status}=''pending'', {Sync Status}=''error'', {Sync Status}=BLANK())',
  100,

  -- field_mappings: identical to community trapper (same Airtable field names)
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

  -- pipeline_config: same as community trapper, except trapper_type = ffsc_volunteer
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
          "trapper_type": "ffsc_volunteer",
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
          "trapper_type": "''ffsc_volunteer''",
          "notes": "CASE WHEN sot.trapper_profiles.notes IS NULL THEN EXCLUDED.notes WHEN EXCLUDED.notes IS NULL THEN sot.trapper_profiles.notes ELSE sot.trapper_profiles.notes || E''\\n[FFSC Agreement Sync] '' || EXCLUDED.notes END",
          "updated_at": "NOW()"
        }
      },
      {
        "type": "audit_trail",
        "entity_type": "person",
        "edit_type": "create",
        "field_name": "trapper_onboarding",
        "edit_source": "ffsc-trapper-agreement-sync",
        "reason": "FFSC trapper agreement synced from Airtable (post-orientation)",
        "new_value_fields": ["email", "match_type", "has_signature", "availability"]
      }
    ],
    "entity_id_type": "person_id"
  }'::jsonb,

  -- writeback_config: identical (same Airtable field names)
  '{
    "status_field": "Sync Status",
    "error_field": "Sync Error",
    "entity_id_field": "Atlas Person ID",
    "synced_at_field": "Synced At",
    "success_status": "synced",
    "error_status": "error"
  }'::jsonb,

  NULL,     -- no cron schedule (webhook-only for now)
  TRUE,
  FALSE,
  100,
  60
)
ON CONFLICT (name) DO NOTHING;

COMMIT;
