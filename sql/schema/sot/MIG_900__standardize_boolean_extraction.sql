-- ============================================================================
-- MIG_900: Standardize Boolean Value Extraction
-- ============================================================================
-- Problem: Boolean extraction is inconsistent across the codebase:
--   - MIG_870 health flags: IN ('Yes', 'TRUE', 'true') - missing 'Y', 'Checked'
--   - MIG_899 misc flags: IN ('Yes', 'TRUE', 'true', 'Y', 'Checked') - better
--   - process_staged_appointment(): uses = 'Yes' for some, IN for others
--
-- Solution:
--   1. Create canonical is_positive_value() function
--   2. Update process_staged_appointment() for ongoing stability
--   3. Re-backfill ALL boolean flags with complete value set
-- ============================================================================

\echo '=== MIG_900: Standardize Boolean Value Extraction ==='
\echo ''

-- ============================================================================
-- Phase 1: Create canonical boolean value checking function
-- ============================================================================

\echo 'Phase 1: Creating canonical is_positive_value() function...'

CREATE OR REPLACE FUNCTION trapper.is_positive_value(val TEXT)
RETURNS BOOLEAN AS $$
BEGIN
  -- Handles: Yes, TRUE, true, Y, Checked, Positive, 1
  -- Also handles location-specific values: Left, Right, Bilateral (for cryptorchid)
  -- Case-insensitive comparison via LOWER()
  RETURN COALESCE(LOWER(TRIM(val)), '') IN
    ('yes', 'true', 'y', 'checked', 'positive', '1', 'left', 'right', 'bilateral');
END;
$$ LANGUAGE plpgsql IMMUTABLE;

COMMENT ON FUNCTION trapper.is_positive_value IS
'Canonical boolean value checker for ClinicHQ fields. Use this instead of hardcoded IN clauses.
Handles (case-insensitive): Yes, TRUE, true, Y, Checked, Positive, 1, Left, Right, Bilateral.
For location-specific fields like Cryptorchid, Left/Right/Bilateral indicate positive status.

Usage:
  - Always use this function for boolean extraction from raw payloads
  - Never use simple = ''Yes'' or hardcoded IN clauses
  - This ensures consistency across all data processing

Examples:
  trapper.is_positive_value(''Yes'') → TRUE
  trapper.is_positive_value(''Y'') → TRUE
  trapper.is_positive_value(''Checked'') → TRUE
  trapper.is_positive_value(''Bilateral'') → TRUE (for cryptorchid)
  trapper.is_positive_value(''No'') → FALSE
  trapper.is_positive_value('''') → FALSE
  trapper.is_positive_value(NULL) → FALSE';

-- ============================================================================
-- Phase 2: Update process_staged_appointment() for ONGOING STABILITY
-- ============================================================================
-- This function is called by the ingest pipeline when NEW appointments come in.
-- Without this update, new data would still use the old incomplete pattern.

\echo ''
\echo 'Phase 2: Updating process_staged_appointment() to use is_positive_value()...'

CREATE OR REPLACE FUNCTION trapper.process_staged_appointment(
    p_staged_record_id UUID
) RETURNS JSONB AS $$
DECLARE
    v_record RECORD;
    v_microchip TEXT;
    v_appointment_number TEXT;
    v_appointment_date DATE;
    v_cat_id UUID;
    v_appointment_id UUID;
    v_service_type TEXT;
    v_result JSONB;
BEGIN
    -- Get the staged record
    SELECT * INTO v_record
    FROM trapper.staged_records
    WHERE staged_record_id = p_staged_record_id
      AND source_system = 'clinichq'
      AND source_table = 'appointment_info'
      AND processed_at IS NULL;

    IF NOT FOUND THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Staged record not found or not a ClinicHQ appointment'
        );
    END IF;

    -- Extract key fields
    v_microchip := NULLIF(TRIM(v_record.payload->>'Microchip Number'), '');
    v_appointment_number := NULLIF(TRIM(v_record.payload->>'Number'), '');
    v_service_type := v_record.payload->>'Service / Subsidy';

    -- Parse date (ClinicHQ uses MM/DD/YYYY format)
    BEGIN
        v_appointment_date := TO_DATE(v_record.payload->>'Date', 'MM/DD/YYYY');
    EXCEPTION WHEN OTHERS THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Invalid date format: ' || COALESCE(v_record.payload->>'Date', 'NULL')
        );
    END;

    IF v_appointment_date IS NULL THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Missing appointment date'
        );
    END IF;

    -- Check if appointment already exists
    SELECT appointment_id INTO v_appointment_id
    FROM trapper.sot_appointments
    WHERE appointment_number = v_appointment_number;

    IF v_appointment_id IS NOT NULL THEN
        RETURN jsonb_build_object(
            'success', true,
            'skipped', true,
            'reason', 'Appointment already exists',
            'appointment_id', v_appointment_id
        );
    END IF;

    -- Find cat by microchip (use centralized lookup)
    IF v_microchip IS NOT NULL THEN
        SELECT ci.cat_id INTO v_cat_id
        FROM trapper.cat_identifiers ci
        JOIN trapper.sot_cats c ON c.cat_id = ci.cat_id
        WHERE ci.id_type = 'microchip'
          AND ci.id_value = v_microchip
          AND c.merged_into_cat_id IS NULL
        LIMIT 1;

        -- Follow merge chain if needed
        IF v_cat_id IS NOT NULL THEN
            v_cat_id := trapper.get_canonical_cat_id(v_cat_id);
        END IF;
    END IF;

    -- Create the appointment with all enriched fields from payload
    -- MIG_900: All boolean extraction now uses trapper.is_positive_value()
    INSERT INTO trapper.sot_appointments (
        cat_id,
        appointment_date,
        appointment_number,
        service_type,
        is_spay,
        is_neuter,
        vet_name,
        technician,
        temperature,
        medical_notes,
        is_lactating,
        is_pregnant,
        is_in_heat,
        -- MIG_870 enriched columns from appointment_info payload
        has_uri,
        has_dental_disease,
        has_ear_issue,
        has_eye_issue,
        has_skin_issue,
        has_mouth_issue,
        has_fleas,
        has_ticks,
        has_tapeworms,
        has_ear_mites,
        has_ringworm,
        felv_fiv_result,
        body_composition_score,
        no_surgery_reason,
        -- MIG_899 enriched misc flags
        has_polydactyl,
        has_bradycardia,
        has_too_young_for_rabies,
        has_cryptorchid,
        has_hernia,
        has_pyometra,
        -- Financial
        total_invoiced,
        subsidy_value,
        data_source,
        source_system,
        source_record_id,
        source_row_hash
    ) VALUES (
        v_cat_id,
        v_appointment_date,
        v_appointment_number,
        v_service_type,
        -- MIG_900: Use is_positive_value() for all boolean extraction
        trapper.is_positive_value(v_record.payload->>'Spay'),
        trapper.is_positive_value(v_record.payload->>'Neuter'),
        v_record.payload->>'Vet Name',
        v_record.payload->>'Technician',
        NULLIF(v_record.payload->>'Temperature', '')::NUMERIC(4,1),
        v_record.payload->>'Internal Medical Notes',
        trapper.is_positive_value(v_record.payload->>'Lactating') OR trapper.is_positive_value(v_record.payload->>'Lactating_2'),
        trapper.is_positive_value(v_record.payload->>'Pregnant'),
        trapper.is_positive_value(v_record.payload->>'In Heat'),
        -- Health screening - using is_positive_value()
        trapper.is_positive_value(COALESCE(v_record.payload->>'URI', v_record.payload->>'Upper Respiratory Issue')),
        trapper.is_positive_value(v_record.payload->>'Dental Disease'),
        trapper.is_positive_value(COALESCE(v_record.payload->>'Ear Issue', v_record.payload->>'Ear infections')),
        trapper.is_positive_value(v_record.payload->>'Eye Issue'),
        trapper.is_positive_value(v_record.payload->>'Skin Issue'),
        trapper.is_positive_value(v_record.payload->>'Mouth Issue'),
        trapper.is_positive_value(COALESCE(v_record.payload->>'Fleas', v_record.payload->>'Fleas_1', v_record.payload->>'Fleas_2', v_record.payload->>'Fleas/Ticks')),
        trapper.is_positive_value(COALESCE(v_record.payload->>'Ticks', v_record.payload->>'Ticks_1', v_record.payload->>'Ticks_2')),
        trapper.is_positive_value(COALESCE(v_record.payload->>'Tapeworms', v_record.payload->>'Tapeworms_1', v_record.payload->>'Tapeworms_2')),
        trapper.is_positive_value(v_record.payload->>'Ear mites'),
        trapper.is_positive_value(v_record.payload->>'Wood''s Lamp Ringworm Test'),
        -- Tests & surgery (not boolean)
        NULLIF(TRIM(v_record.payload->>'FeLV/FIV (SNAP test, in-house)'), ''),
        NULLIF(TRIM(v_record.payload->>'Body Composition Score'), ''),
        NULLIF(TRIM(v_record.payload->>'No Surgery Reason'), ''),
        -- MIG_899 misc flags - using is_positive_value()
        trapper.is_positive_value(v_record.payload->>'Polydactyl'),
        trapper.is_positive_value(v_record.payload->>'Bradycardia Intra-Op'),
        trapper.is_positive_value(v_record.payload->>'Too young for rabies'),
        trapper.is_positive_value(v_record.payload->>'Cryptorchid'),
        trapper.is_positive_value(v_record.payload->>'Hernia'),
        trapper.is_positive_value(v_record.payload->>'Pyometra'),
        -- Financial
        CASE
          WHEN v_record.payload->>'Total Invoiced' ~ '^\$?[0-9]+\.?[0-9]*$'
          THEN REPLACE(v_record.payload->>'Total Invoiced', '$', '')::NUMERIC(10,2)
          ELSE NULL
        END,
        CASE
          WHEN v_record.payload->>'Sub Value' ~ '^\$?[0-9]+\.?[0-9]*$'
          THEN REPLACE(v_record.payload->>'Sub Value', '$', '')::NUMERIC(10,2)
          ELSE NULL
        END,
        'clinichq',
        'clinichq',
        v_record.source_row_id,
        v_record.row_hash
    )
    RETURNING appointment_id INTO v_appointment_id;

    -- Mark staged record as processed
    UPDATE trapper.staged_records
    SET processed_at = NOW()
    WHERE staged_record_id = p_staged_record_id;

    v_result := jsonb_build_object(
        'success', true,
        'appointment_id', v_appointment_id,
        'cat_id', v_cat_id,
        'appointment_number', v_appointment_number,
        'appointment_date', v_appointment_date
    );

    RETURN v_result;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.process_staged_appointment IS
'Processes a single staged ClinicHQ appointment record into sot_appointments.
Uses centralized cat lookup and follows merge chains.
MIG_871: Populates health screening, tests, financial columns from payload.
MIG_900: All boolean extraction uses is_positive_value() for consistency.
Cat weight/age and client info are populated by cat_info and owner_info processing.';

-- ============================================================================
-- Phase 3: Re-backfill ALL boolean flags with complete value set
-- ============================================================================
-- This fixes existing data that was inserted with incomplete boolean checking

\echo ''
\echo 'Phase 3: Re-backfilling all boolean flags with is_positive_value()...'

WITH backfill AS (
  UPDATE trapper.sot_appointments a
  SET
    -- Core status flags
    is_spay = trapper.is_positive_value(appt.payload->>'Spay'),
    is_neuter = trapper.is_positive_value(appt.payload->>'Neuter'),
    is_lactating = trapper.is_positive_value(appt.payload->>'Lactating') OR trapper.is_positive_value(appt.payload->>'Lactating_2'),
    is_pregnant = trapper.is_positive_value(appt.payload->>'Pregnant'),
    is_in_heat = trapper.is_positive_value(appt.payload->>'In Heat'),
    -- Health screening flags
    has_uri = trapper.is_positive_value(COALESCE(appt.payload->>'URI', appt.payload->>'Upper Respiratory Issue')),
    has_dental_disease = trapper.is_positive_value(appt.payload->>'Dental Disease'),
    has_ear_issue = trapper.is_positive_value(COALESCE(appt.payload->>'Ear Issue', appt.payload->>'Ear infections')),
    has_eye_issue = trapper.is_positive_value(appt.payload->>'Eye Issue'),
    has_skin_issue = trapper.is_positive_value(appt.payload->>'Skin Issue'),
    has_mouth_issue = trapper.is_positive_value(appt.payload->>'Mouth Issue'),
    has_fleas = trapper.is_positive_value(COALESCE(appt.payload->>'Fleas', appt.payload->>'Fleas_1', appt.payload->>'Fleas_2', appt.payload->>'Fleas/Ticks')),
    has_ticks = trapper.is_positive_value(COALESCE(appt.payload->>'Ticks', appt.payload->>'Ticks_1', appt.payload->>'Ticks_2')),
    has_tapeworms = trapper.is_positive_value(COALESCE(appt.payload->>'Tapeworms', appt.payload->>'Tapeworms_1', appt.payload->>'Tapeworms_2')),
    has_ear_mites = trapper.is_positive_value(appt.payload->>'Ear mites'),
    has_ringworm = trapper.is_positive_value(appt.payload->>'Wood''s Lamp Ringworm Test'),
    -- Misc flags (MIG_899)
    has_polydactyl = trapper.is_positive_value(appt.payload->>'Polydactyl'),
    has_bradycardia = trapper.is_positive_value(appt.payload->>'Bradycardia Intra-Op'),
    has_too_young_for_rabies = trapper.is_positive_value(appt.payload->>'Too young for rabies'),
    has_cryptorchid = trapper.is_positive_value(appt.payload->>'Cryptorchid'),
    has_hernia = trapper.is_positive_value(appt.payload->>'Hernia'),
    has_pyometra = trapper.is_positive_value(appt.payload->>'Pyometra'),
    -- Track the update
    updated_at = NOW()
  FROM trapper.staged_records appt
  WHERE appt.source_system = 'clinichq'
    AND appt.source_table = 'appointment_info'
    AND appt.payload->>'Number' = a.appointment_number
    AND appt.payload->>'Date' IS NOT NULL
    AND TO_DATE(appt.payload->>'Date', 'MM/DD/YYYY') = a.appointment_date
  RETURNING a.appointment_id
)
SELECT COUNT(*) as appointments_updated FROM backfill;

-- ============================================================================
-- Phase 4: Verification queries
-- ============================================================================

\echo ''
\echo 'Phase 4: Running verification...'

-- Show function behavior
\echo ''
\echo 'Testing is_positive_value():'
SELECT
  trapper.is_positive_value('Yes') as yes_check,
  trapper.is_positive_value('TRUE') as true_check,
  trapper.is_positive_value('Y') as y_check,
  trapper.is_positive_value('Checked') as checked_check,
  trapper.is_positive_value('Positive') as positive_check,
  trapper.is_positive_value('Bilateral') as bilateral_check,
  trapper.is_positive_value('No') as no_check,
  trapper.is_positive_value('') as empty_check,
  trapper.is_positive_value(NULL) as null_check;

-- Show health flag counts
\echo ''
\echo 'Health flag counts after backfill:'
SELECT
  COUNT(*) as total_appointments,
  COUNT(*) FILTER (WHERE has_uri) as uri_positive,
  COUNT(*) FILTER (WHERE has_fleas) as fleas_positive,
  COUNT(*) FILTER (WHERE has_dental_disease) as dental_positive,
  COUNT(*) FILTER (WHERE has_ear_issue) as ear_issue_positive,
  COUNT(*) FILTER (WHERE has_ringworm) as ringworm_positive
FROM trapper.sot_appointments;

-- Show misc flag counts
\echo ''
\echo 'Misc flag counts after backfill:'
SELECT
  COUNT(*) FILTER (WHERE has_polydactyl) as polydactyl_positive,
  COUNT(*) FILTER (WHERE has_bradycardia) as bradycardia_positive,
  COUNT(*) FILTER (WHERE has_too_young_for_rabies) as too_young_rabies_positive,
  COUNT(*) FILTER (WHERE has_cryptorchid) as cryptorchid_positive,
  COUNT(*) FILTER (WHERE has_hernia) as hernia_positive,
  COUNT(*) FILTER (WHERE has_pyometra) as pyometra_positive
FROM trapper.sot_appointments;

-- ============================================================================
-- Summary
-- ============================================================================

\echo ''
\echo '=============================================='
\echo 'MIG_900 Complete!'
\echo '=============================================='
\echo ''
\echo 'Changes made:'
\echo '  1. Created trapper.is_positive_value() - canonical boolean checker'
\echo '  2. Updated process_staged_appointment() - new data uses consistent extraction'
\echo '  3. Re-backfilled all boolean flags on existing appointments'
\echo ''
\echo 'is_positive_value() handles (case-insensitive):'
\echo '  - Yes, TRUE, true, Y, Checked, Positive, 1'
\echo '  - Left, Right, Bilateral (for location-specific fields like Cryptorchid)'
\echo ''
\echo 'IMPORTANT: Always use trapper.is_positive_value() for boolean extraction.'
\echo 'Never use = ''Yes'' or hardcoded IN clauses.'
\echo ''
