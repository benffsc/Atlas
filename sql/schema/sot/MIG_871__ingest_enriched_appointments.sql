\echo '=== MIG_871: Update appointment ingest to populate enriched columns ==='
\echo ''
\echo 'Updates process_staged_appointment() to extract health screening, tests,'
\echo 'financial data directly from the appointment_info payload on insert.'
\echo 'Cat weight/age and client info are populated later by cat_info and owner_info processing.'
\echo ''

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
        v_record.payload->>'Spay' = 'Yes',
        v_record.payload->>'Neuter' = 'Yes',
        v_record.payload->>'Vet Name',
        v_record.payload->>'Technician',
        NULLIF(v_record.payload->>'Temperature', '')::NUMERIC(4,1),
        v_record.payload->>'Internal Medical Notes',
        v_record.payload->>'Lactating' = 'Yes' OR v_record.payload->>'Lactating_2' = 'Yes',
        v_record.payload->>'Pregnant' = 'Yes',
        v_record.payload->>'In Heat' = 'Yes',
        -- Health screening
        COALESCE(v_record.payload->>'URI', v_record.payload->>'Upper Respiratory Issue', '') IN ('Yes', 'TRUE', 'true'),
        COALESCE(v_record.payload->>'Dental Disease', '') IN ('Yes', 'TRUE', 'true'),
        COALESCE(v_record.payload->>'Ear Issue', v_record.payload->>'Ear infections', '') IN ('Yes', 'TRUE', 'true'),
        COALESCE(v_record.payload->>'Eye Issue', '') IN ('Yes', 'TRUE', 'true'),
        COALESCE(v_record.payload->>'Skin Issue', '') IN ('Yes', 'TRUE', 'true'),
        COALESCE(v_record.payload->>'Mouth Issue', '') IN ('Yes', 'TRUE', 'true'),
        COALESCE(v_record.payload->>'Fleas', v_record.payload->>'Fleas_1', v_record.payload->>'Fleas_2', v_record.payload->>'Fleas/Ticks', '') IN ('Yes', 'TRUE', 'true'),
        COALESCE(v_record.payload->>'Ticks', v_record.payload->>'Ticks_1', v_record.payload->>'Ticks_2', '') IN ('Yes', 'TRUE', 'true'),
        COALESCE(v_record.payload->>'Tapeworms', v_record.payload->>'Tapeworms_1', v_record.payload->>'Tapeworms_2', '') IN ('Yes', 'TRUE', 'true'),
        COALESCE(v_record.payload->>'Ear mites', '') IN ('Yes', 'TRUE', 'true'),
        COALESCE(v_record.payload->>'Wood''s Lamp Ringworm Test', '') IN ('Positive', 'Yes', 'TRUE', 'true'),
        -- Tests & surgery
        NULLIF(TRIM(v_record.payload->>'FeLV/FIV (SNAP test, in-house)'), ''),
        NULLIF(TRIM(v_record.payload->>'Body Composition Score'), ''),
        NULLIF(TRIM(v_record.payload->>'No Surgery Reason'), ''),
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
MIG_871: Now populates health screening, tests, financial columns from payload.
Cat weight/age and client info are populated by cat_info and owner_info processing.';

-- ==============================================================
-- Also update process_clinichq_owner_info to backfill client snapshot
-- ==============================================================

\echo 'Adding client snapshot backfill to owner_info processing...'

-- After owner_info processing, backfill client_name/address/ownership
-- on sot_appointments where those fields are NULL
CREATE OR REPLACE FUNCTION trapper.backfill_appointment_client_info()
RETURNS JSONB AS $$
DECLARE
  v_count INT;
BEGIN
  WITH updates AS (
    UPDATE trapper.sot_appointments a
    SET
      client_name = NULLIF(TRIM(
        COALESCE(NULLIF(TRIM(own_sr.payload->>'Owner First Name'), ''), '') || ' ' ||
        COALESCE(NULLIF(TRIM(own_sr.payload->>'Owner Last Name'), ''), '')
      ), ''),
      client_address = NULLIF(TRIM(own_sr.payload->>'Owner Address'), ''),
      ownership_type = NULLIF(TRIM(own_sr.payload->>'Ownership'), '')
    FROM trapper.staged_records own_sr
    WHERE own_sr.source_system = 'clinichq'
      AND own_sr.source_table = 'owner_info'
      AND own_sr.payload->>'Number' = a.appointment_number
      AND a.client_name IS NULL
    RETURNING a.appointment_id
  )
  SELECT COUNT(*) INTO v_count FROM updates;

  RETURN jsonb_build_object('client_info_backfilled', v_count);
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.backfill_appointment_client_info IS
'Backfills client_name, client_address, and ownership_type on sot_appointments
from owner_info staged records. Called after owner_info processing. MIG_871.';

-- ==============================================================
-- Also add weight/age backfill from cat_info
-- ==============================================================

CREATE OR REPLACE FUNCTION trapper.backfill_appointment_cat_vitals()
RETURNS JSONB AS $$
DECLARE
  v_count INT;
BEGIN
  WITH updates AS (
    UPDATE trapper.sot_appointments a
    SET
      cat_weight_lbs = CASE
        WHEN cat_sr.payload->>'Weight' ~ '^[0-9]+\.?[0-9]*$'
          AND (cat_sr.payload->>'Weight')::NUMERIC > 0
        THEN (cat_sr.payload->>'Weight')::NUMERIC(5,2)
        ELSE NULL
      END,
      cat_age_years = CASE
        WHEN cat_sr.payload->>'Age Years' ~ '^[0-9]+$'
        THEN (cat_sr.payload->>'Age Years')::INT
        ELSE NULL
      END,
      cat_age_months = CASE
        WHEN cat_sr.payload->>'Age Months' ~ '^[0-9]+$'
        THEN (cat_sr.payload->>'Age Months')::INT
        ELSE NULL
      END
    FROM trapper.staged_records appt
    JOIN trapper.staged_records cat_sr
      ON cat_sr.source_system = 'clinichq'
      AND cat_sr.source_table = 'cat_info'
      AND cat_sr.payload->>'Microchip Number' = appt.payload->>'Microchip Number'
      AND cat_sr.payload->>'Microchip Number' IS NOT NULL
      AND TRIM(cat_sr.payload->>'Microchip Number') != ''
    WHERE appt.source_system = 'clinichq'
      AND appt.source_table = 'appointment_info'
      AND appt.payload->>'Number' = a.appointment_number
      AND TO_DATE(appt.payload->>'Date', 'MM/DD/YYYY') = a.appointment_date
      AND a.cat_weight_lbs IS NULL
    RETURNING a.appointment_id
  )
  SELECT COUNT(*) INTO v_count FROM updates;

  RETURN jsonb_build_object('cat_vitals_backfilled', v_count);
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.backfill_appointment_cat_vitals IS
'Backfills cat_weight_lbs, cat_age_years, cat_age_months on sot_appointments
from cat_info staged records. Called after cat_info processing. MIG_871.';

\echo ''
\echo '=== MIG_871 complete ==='
\echo 'process_staged_appointment() now populates health screening, tests, financial.'
\echo 'backfill_appointment_client_info() and backfill_appointment_cat_vitals() created.'
