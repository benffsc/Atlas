-- MIG_2944: Foster Agreement Airtable Sync Config (FFS-563)
--
-- Adds sync config for foster agreements from Airtable.
-- Source: Same base as trapper agreements (appwFuRddph1krmcd),
--         table "Foster Agreements" (to be confirmed)
--
-- Pipeline: data_import (no person_onboarding needed — we only resolve person_id)
--
-- After running the sync engine, process records with the INSERT below.

BEGIN;

-- 1. Register the sync config
INSERT INTO ops.airtable_sync_configs (
  name, description,
  airtable_base_id, airtable_table_name,
  filter_formula, page_size,
  field_mappings, pipeline, pipeline_config,
  writeback_config,
  max_records_per_run, max_duration_seconds,
  is_active
) VALUES (
  'foster-agreements',
  'Import signed foster agreements from Airtable. 259 foster + 9 forever foster contracts.',
  'appwFuRddph1krmcd',
  'Foster Agreements',
  'OR({Sync Status}=''pending'', {Sync Status}=''error'', {Sync Status}=BLANK())',
  100,
  '{
    "First Name": {"maps_to": "first_name", "required": false},
    "Last Name": {"maps_to": "last_name", "required": false},
    "Email": {"maps_to": "email", "required": false},
    "Phone": {"maps_to": "phone", "required": false},
    "Agreement Type": {"maps_to": "agreement_type", "required": false, "default_value": "foster"},
    "Date Signed": {"maps_to": "signed_at", "required": false, "transform": "parse_date"},
    "Notes": {"maps_to": "notes", "required": false}
  }'::JSONB,
  'data_import',
  '{"target_table": "ops.foster_agreements"}'::JSONB,
  '{
    "status_field": "Sync Status",
    "status_value": "synced",
    "error_value": "error",
    "id_field": "Atlas Agreement ID"
  }'::JSONB,
  300,
  120,
  TRUE
) ON CONFLICT (name) DO NOTHING;

-- 2. Processing function: matches persons by email/phone and inserts agreements
-- Run after airtable_raw contains foster agreement records.
CREATE OR REPLACE FUNCTION ops.process_foster_agreements_from_raw()
RETURNS TABLE (
  processed INT,
  skipped INT,
  errors INT
) LANGUAGE plpgsql AS $$
DECLARE
  v_processed INT := 0;
  v_skipped INT := 0;
  v_errors INT := 0;
  rec RECORD;
BEGIN
  FOR rec IN
    SELECT
      ar.record_id,
      ar.payload->>'Email' AS email,
      ar.payload->>'Phone' AS phone,
      ar.payload->>'First Name' AS first_name,
      ar.payload->>'Last Name' AS last_name,
      COALESCE(ar.payload->>'Agreement Type', 'foster') AS agreement_type,
      (ar.payload->>'Date Signed')::TIMESTAMPTZ AS signed_at,
      ar.payload->>'Notes' AS notes
    FROM source.airtable_raw ar
    WHERE ar.table_name = 'Foster Agreements'
      AND NOT EXISTS (
        SELECT 1 FROM ops.foster_agreements fa
        WHERE fa.source_system = 'airtable'
          AND fa.source_record_id = ar.record_id
      )
  LOOP
    BEGIN
      -- Skip if no email or phone to match on
      IF rec.email IS NULL AND rec.phone IS NULL THEN
        v_skipped := v_skipped + 1;
        CONTINUE;
      END IF;

      -- Resolve person by email/phone using centralized function
      DECLARE
        v_person_id UUID;
        v_agreement_type TEXT;
      BEGIN
        v_person_id := (
          SELECT p.person_id
          FROM sot.people p
          JOIN sot.person_identifiers pi ON pi.person_id = p.person_id
          WHERE p.merged_into_person_id IS NULL
            AND pi.confidence >= 0.5
            AND (
              (pi.id_type = 'email' AND pi.id_value_norm = LOWER(TRIM(rec.email)))
              OR (pi.id_type = 'phone' AND pi.id_value_norm = regexp_replace(rec.phone, '[^0-9]', '', 'g'))
            )
          LIMIT 1
        );

        IF v_person_id IS NULL THEN
          v_skipped := v_skipped + 1;
          CONTINUE;
        END IF;

        -- Normalize agreement type
        v_agreement_type := CASE
          WHEN LOWER(rec.agreement_type) LIKE '%forever%' THEN 'forever_foster'
          ELSE 'foster'
        END;

        INSERT INTO ops.foster_agreements (
          person_id, agreement_type, signed_at,
          source_system, source_record_id, notes
        ) VALUES (
          v_person_id, v_agreement_type, rec.signed_at,
          'airtable', rec.record_id, rec.notes
        ) ON CONFLICT (source_system, source_record_id)
          WHERE source_record_id IS NOT NULL
          DO NOTHING;

        v_processed := v_processed + 1;
      END;
    EXCEPTION WHEN OTHERS THEN
      v_errors := v_errors + 1;
      RAISE WARNING 'Error processing foster agreement %: %', rec.record_id, SQLERRM;
    END;
  END LOOP;

  RETURN QUERY SELECT v_processed, v_skipped, v_errors;
END;
$$;

COMMENT ON FUNCTION ops.process_foster_agreements_from_raw() IS
'Processes foster agreements from source.airtable_raw into ops.foster_agreements.
Matches persons by email/phone. Run after Airtable sync populates raw records.';

COMMIT;
