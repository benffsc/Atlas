-- MIG_261: Process ClinicHQ Appointments Function
--
-- Problem:
--   The extract_procedures_from_appointments.mjs script does direct INSERTs
--   which bypasses centralized entity handling. This can lead to:
--   - Orphaned appointments (cat not found)
--   - Missing audit trail
--   - Inconsistent data handling
--
-- Solution:
--   Create a SQL function that properly processes staged ClinicHQ records
--   into sot_appointments and cat_procedures, using centralized patterns.
--
-- APPLY:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f sql/schema/sot/MIG_261__process_clinichq_appointments.sql

\echo ''
\echo '=============================================='
\echo 'MIG_261: Process ClinicHQ Appointments'
\echo '=============================================='
\echo ''

-- ============================================================
-- 1. Create function to process a single staged appointment
-- ============================================================

\echo '1. Creating process_staged_appointment function...'

CREATE OR REPLACE FUNCTION trapper.process_staged_appointment(
    p_staged_record_id UUID
) RETURNS jsonb AS $$
DECLARE
    v_record RECORD;
    v_cat_id UUID;
    v_appointment_id UUID;
    v_result jsonb;
    v_microchip TEXT;
    v_appointment_date DATE;
    v_appointment_number TEXT;
    v_service_type TEXT;
BEGIN
    -- Get the staged record
    SELECT * INTO v_record
    FROM trapper.staged_records
    WHERE staged_record_id = p_staged_record_id
      AND source_system = 'clinichq'
      AND source_table = 'appointment_info';

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

    -- Create the appointment (cat_id can be NULL - will link later)
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
Returns JSON with success status and created appointment_id.';

-- ============================================================
-- 2. Create function to process all pending appointments
-- ============================================================

\echo '2. Creating process_pending_clinichq_appointments function...'

CREATE OR REPLACE FUNCTION trapper.process_pending_clinichq_appointments(
    p_limit INT DEFAULT 1000
) RETURNS jsonb AS $$
DECLARE
    v_record RECORD;
    v_result jsonb;
    v_processed INT := 0;
    v_created INT := 0;
    v_skipped INT := 0;
    v_errors INT := 0;
BEGIN
    FOR v_record IN
        SELECT staged_record_id
        FROM trapper.staged_records
        WHERE source_system = 'clinichq'
          AND source_table = 'appointment_info'
          AND processed_at IS NULL
          AND payload->>'Date' IS NOT NULL
          AND payload->>'Date' <> ''
        ORDER BY source_created_at
        LIMIT p_limit
    LOOP
        v_result := trapper.process_staged_appointment(v_record.staged_record_id);
        v_processed := v_processed + 1;

        IF v_result->>'success' = 'true' THEN
            IF v_result->>'skipped' = 'true' THEN
                v_skipped := v_skipped + 1;
            ELSE
                v_created := v_created + 1;
            END IF;
        ELSE
            v_errors := v_errors + 1;
        END IF;
    END LOOP;

    RETURN jsonb_build_object(
        'processed', v_processed,
        'created', v_created,
        'skipped', v_skipped,
        'errors', v_errors
    );
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.process_pending_clinichq_appointments IS
'Processes all pending ClinicHQ appointment staged records.
Returns summary of processed/created/skipped/errors counts.';

-- ============================================================
-- 3. Create function to create procedures from appointments
-- ============================================================

\echo '3. Creating create_procedures_from_appointments function...'

CREATE OR REPLACE FUNCTION trapper.create_procedures_from_appointments(
    p_limit INT DEFAULT 1000
) RETURNS jsonb AS $$
DECLARE
    v_spays_created INT := 0;
    v_neuters_created INT := 0;
    v_cats_updated INT := 0;
BEGIN
    -- Create spay procedures
    WITH inserted AS (
        INSERT INTO trapper.cat_procedures (
            cat_id, appointment_id, procedure_type, procedure_date, status,
            performed_by, technician,
            is_spay, is_neuter, is_cryptorchid, is_pre_scrotal,
            staples_used,
            source_system, source_record_id
        )
        SELECT
            a.cat_id,
            a.appointment_id,
            'spay',
            a.appointment_date,
            'completed'::trapper.procedure_status,
            a.vet_name,
            a.technician,
            TRUE, FALSE, FALSE, FALSE, FALSE,
            'clinichq',
            a.appointment_number
        FROM trapper.sot_appointments a
        WHERE a.cat_id IS NOT NULL
          AND a.service_type ILIKE '%spay%'
          AND NOT EXISTS (
              SELECT 1 FROM trapper.cat_procedures cp
              WHERE cp.appointment_id = a.appointment_id AND cp.is_spay = TRUE
          )
        LIMIT p_limit
        ON CONFLICT DO NOTHING
        RETURNING procedure_id
    )
    SELECT COUNT(*) INTO v_spays_created FROM inserted;

    -- Create neuter procedures
    WITH inserted AS (
        INSERT INTO trapper.cat_procedures (
            cat_id, appointment_id, procedure_type, procedure_date, status,
            performed_by, technician,
            is_spay, is_neuter, is_cryptorchid, is_pre_scrotal,
            staples_used,
            source_system, source_record_id
        )
        SELECT
            a.cat_id,
            a.appointment_id,
            'neuter',
            a.appointment_date,
            'completed'::trapper.procedure_status,
            a.vet_name,
            a.technician,
            FALSE, TRUE, FALSE, FALSE, FALSE,
            'clinichq',
            a.appointment_number
        FROM trapper.sot_appointments a
        WHERE a.cat_id IS NOT NULL
          AND a.service_type ILIKE '%neuter%'
          AND NOT EXISTS (
              SELECT 1 FROM trapper.cat_procedures cp
              WHERE cp.appointment_id = a.appointment_id AND cp.is_neuter = TRUE
          )
        LIMIT p_limit
        ON CONFLICT DO NOTHING
        RETURNING procedure_id
    )
    SELECT COUNT(*) INTO v_neuters_created FROM inserted;

    -- Update cat altered_status
    WITH updated_spayed AS (
        UPDATE trapper.sot_cats c
        SET altered_status = 'spayed', updated_at = NOW()
        WHERE c.altered_status IS DISTINCT FROM 'spayed'
          AND EXISTS (
              SELECT 1 FROM trapper.cat_procedures cp
              WHERE cp.cat_id = c.cat_id AND cp.is_spay = TRUE
          )
        RETURNING cat_id
    ),
    updated_neutered AS (
        UPDATE trapper.sot_cats c
        SET altered_status = 'neutered', updated_at = NOW()
        WHERE c.altered_status IS DISTINCT FROM 'neutered'
          AND c.altered_status IS DISTINCT FROM 'spayed'
          AND EXISTS (
              SELECT 1 FROM trapper.cat_procedures cp
              WHERE cp.cat_id = c.cat_id AND cp.is_neuter = TRUE
          )
        RETURNING cat_id
    )
    SELECT (SELECT COUNT(*) FROM updated_spayed) + (SELECT COUNT(*) FROM updated_neutered)
    INTO v_cats_updated;

    RETURN jsonb_build_object(
        'spays_created', v_spays_created,
        'neuters_created', v_neuters_created,
        'cats_updated', v_cats_updated
    );
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.create_procedures_from_appointments IS
'Creates cat_procedures from sot_appointments based on service_type.
Also updates sot_cats.altered_status accordingly.
Returns counts of procedures created and cats updated.';

-- ============================================================
-- 4. Verification
-- ============================================================

\echo ''
\echo '====== VERIFICATION ======'

\echo ''
\echo 'Functions created:'
SELECT routine_name, routine_type
FROM information_schema.routines
WHERE routine_schema = 'trapper'
  AND routine_name IN (
      'process_staged_appointment',
      'process_pending_clinichq_appointments',
      'create_procedures_from_appointments'
  )
ORDER BY routine_name;

\echo ''
SELECT 'MIG_261 Complete' AS status;
