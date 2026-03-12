-- MIG_2901: Create ops.flow_appointment_observations() function (FFS-419)
--
-- Problem: MIG_2894-2900 backfilled clinical and reproductive observations from
-- one-time migrations. But the live ingest pipeline does NOT flow appointment
-- boolean flags (has_uri, is_pregnant, etc.) into observation tables. New uploads
-- will have flags on ops.appointments but NEVER reach ops.cat_clinical_observations
-- or ops.cat_reproductive_observations.
--
-- Solution: SQL function called inline during ingest (after appointment INSERT)
-- that flows boolean flags → observation tables. Uses NOT EXISTS guards for
-- idempotency (same pattern as MIG_2899).

CREATE OR REPLACE FUNCTION ops.flow_appointment_observations()
RETURNS TABLE(clinical_inserted INT, reproductive_inserted INT) AS $$
DECLARE
    v_clinical INT := 0;
    v_repro INT := 0;
    v_cnt INT;
BEGIN
    -- =========================================================================
    -- Clinical observations from appointment boolean flags
    -- =========================================================================

    -- URI
    INSERT INTO ops.cat_clinical_observations (
        cat_id, appointment_date, condition_code, source_field,
        source_system, evidence_source, extraction_confidence
    )
    SELECT DISTINCT ON (a.cat_id, a.appointment_date)
        a.cat_id, a.appointment_date, 'uri', 'has_uri',
        'clinichq', 'api_export_structured', 0.95
    FROM ops.appointments a
    WHERE a.cat_id IS NOT NULL AND a.has_uri = TRUE
      AND NOT EXISTS (
          SELECT 1 FROM ops.cat_clinical_observations o
          WHERE o.cat_id = a.cat_id AND o.condition_code = 'uri' AND o.appointment_date = a.appointment_date
      )
    ORDER BY a.cat_id, a.appointment_date;
    GET DIAGNOSTICS v_cnt = ROW_COUNT;
    v_clinical := v_clinical + v_cnt;

    -- Fleas
    INSERT INTO ops.cat_clinical_observations (
        cat_id, appointment_date, condition_code, source_field,
        source_system, evidence_source, extraction_confidence
    )
    SELECT DISTINCT ON (a.cat_id, a.appointment_date)
        a.cat_id, a.appointment_date, 'fleas', 'has_fleas',
        'clinichq', 'api_export_structured', 0.95
    FROM ops.appointments a
    WHERE a.cat_id IS NOT NULL AND a.has_fleas = TRUE
      AND NOT EXISTS (
          SELECT 1 FROM ops.cat_clinical_observations o
          WHERE o.cat_id = a.cat_id AND o.condition_code = 'fleas' AND o.appointment_date = a.appointment_date
      )
    ORDER BY a.cat_id, a.appointment_date;
    GET DIAGNOSTICS v_cnt = ROW_COUNT;
    v_clinical := v_clinical + v_cnt;

    -- Ear mites
    INSERT INTO ops.cat_clinical_observations (
        cat_id, appointment_date, condition_code, source_field,
        source_system, evidence_source, extraction_confidence
    )
    SELECT DISTINCT ON (a.cat_id, a.appointment_date)
        a.cat_id, a.appointment_date, 'ear_mites', 'has_ear_mites',
        'clinichq', 'api_export_structured', 0.95
    FROM ops.appointments a
    WHERE a.cat_id IS NOT NULL AND a.has_ear_mites = TRUE
      AND NOT EXISTS (
          SELECT 1 FROM ops.cat_clinical_observations o
          WHERE o.cat_id = a.cat_id AND o.condition_code = 'ear_mites' AND o.appointment_date = a.appointment_date
      )
    ORDER BY a.cat_id, a.appointment_date;
    GET DIAGNOSTICS v_cnt = ROW_COUNT;
    v_clinical := v_clinical + v_cnt;

    -- Tapeworms
    INSERT INTO ops.cat_clinical_observations (
        cat_id, appointment_date, condition_code, source_field,
        source_system, evidence_source, extraction_confidence
    )
    SELECT DISTINCT ON (a.cat_id, a.appointment_date)
        a.cat_id, a.appointment_date, 'tapeworm', 'has_tapeworms',
        'clinichq', 'api_export_structured', 0.95
    FROM ops.appointments a
    WHERE a.cat_id IS NOT NULL AND a.has_tapeworms = TRUE
      AND NOT EXISTS (
          SELECT 1 FROM ops.cat_clinical_observations o
          WHERE o.cat_id = a.cat_id AND o.condition_code = 'tapeworm' AND o.appointment_date = a.appointment_date
      )
    ORDER BY a.cat_id, a.appointment_date;
    GET DIAGNOSTICS v_cnt = ROW_COUNT;
    v_clinical := v_clinical + v_cnt;

    -- Cryptorchid
    INSERT INTO ops.cat_clinical_observations (
        cat_id, appointment_date, condition_code, source_field,
        source_system, evidence_source, extraction_confidence
    )
    SELECT DISTINCT ON (a.cat_id, a.appointment_date)
        a.cat_id, a.appointment_date, 'cryptorchid', 'has_cryptorchid',
        'clinichq', 'api_export_structured', 0.95
    FROM ops.appointments a
    WHERE a.cat_id IS NOT NULL AND a.has_cryptorchid = TRUE
      AND NOT EXISTS (
          SELECT 1 FROM ops.cat_clinical_observations o
          WHERE o.cat_id = a.cat_id AND o.condition_code = 'cryptorchid' AND o.appointment_date = a.appointment_date
      )
    ORDER BY a.cat_id, a.appointment_date;
    GET DIAGNOSTICS v_cnt = ROW_COUNT;
    v_clinical := v_clinical + v_cnt;

    -- Hernia
    INSERT INTO ops.cat_clinical_observations (
        cat_id, appointment_date, condition_code, source_field,
        source_system, evidence_source, extraction_confidence
    )
    SELECT DISTINCT ON (a.cat_id, a.appointment_date)
        a.cat_id, a.appointment_date, 'hernia', 'has_hernia',
        'clinichq', 'api_export_structured', 0.95
    FROM ops.appointments a
    WHERE a.cat_id IS NOT NULL AND a.has_hernia = TRUE
      AND NOT EXISTS (
          SELECT 1 FROM ops.cat_clinical_observations o
          WHERE o.cat_id = a.cat_id AND o.condition_code = 'hernia' AND o.appointment_date = a.appointment_date
      )
    ORDER BY a.cat_id, a.appointment_date;
    GET DIAGNOSTICS v_cnt = ROW_COUNT;
    v_clinical := v_clinical + v_cnt;

    -- Pyometra
    INSERT INTO ops.cat_clinical_observations (
        cat_id, appointment_date, condition_code, source_field,
        source_system, evidence_source, extraction_confidence
    )
    SELECT DISTINCT ON (a.cat_id, a.appointment_date)
        a.cat_id, a.appointment_date, 'pyometra', 'has_pyometra',
        'clinichq', 'api_export_structured', 0.95
    FROM ops.appointments a
    WHERE a.cat_id IS NOT NULL AND a.has_pyometra = TRUE
      AND NOT EXISTS (
          SELECT 1 FROM ops.cat_clinical_observations o
          WHERE o.cat_id = a.cat_id AND o.condition_code = 'pyometra' AND o.appointment_date = a.appointment_date
      )
    ORDER BY a.cat_id, a.appointment_date;
    GET DIAGNOSTICS v_cnt = ROW_COUNT;
    v_clinical := v_clinical + v_cnt;

    -- Dental disease
    INSERT INTO ops.cat_clinical_observations (
        cat_id, appointment_date, condition_code, source_field,
        source_system, evidence_source, extraction_confidence
    )
    SELECT DISTINCT ON (a.cat_id, a.appointment_date)
        a.cat_id, a.appointment_date, 'dental_disease', 'has_dental_disease',
        'clinichq', 'api_export_structured', 0.95
    FROM ops.appointments a
    WHERE a.cat_id IS NOT NULL AND a.has_dental_disease = TRUE
      AND NOT EXISTS (
          SELECT 1 FROM ops.cat_clinical_observations o
          WHERE o.cat_id = a.cat_id AND o.condition_code = 'dental_disease' AND o.appointment_date = a.appointment_date
      )
    ORDER BY a.cat_id, a.appointment_date;
    GET DIAGNOSTICS v_cnt = ROW_COUNT;
    v_clinical := v_clinical + v_cnt;

    -- Polydactyl
    INSERT INTO ops.cat_clinical_observations (
        cat_id, appointment_date, condition_code, source_field,
        source_system, evidence_source, extraction_confidence
    )
    SELECT DISTINCT ON (a.cat_id, a.appointment_date)
        a.cat_id, a.appointment_date, 'polydactyl', 'has_polydactyl',
        'clinichq', 'api_export_structured', 0.95
    FROM ops.appointments a
    WHERE a.cat_id IS NOT NULL AND a.has_polydactyl = TRUE
      AND NOT EXISTS (
          SELECT 1 FROM ops.cat_clinical_observations o
          WHERE o.cat_id = a.cat_id AND o.condition_code = 'polydactyl' AND o.appointment_date = a.appointment_date
      )
    ORDER BY a.cat_id, a.appointment_date;
    GET DIAGNOSTICS v_cnt = ROW_COUNT;
    v_clinical := v_clinical + v_cnt;

    -- =========================================================================
    -- Reproductive observations from appointment flags
    -- =========================================================================

    -- Pregnancy
    INSERT INTO ops.cat_reproductive_observations (
        cat_id, appointment_date, observation_type, source_field,
        source_system, evidence_source, extraction_confidence
    )
    SELECT DISTINCT ON (a.cat_id, a.appointment_date)
        a.cat_id, a.appointment_date, 'pregnancy', 'is_pregnant',
        'clinichq', 'api_export_structured', 0.95
    FROM ops.appointments a
    WHERE a.cat_id IS NOT NULL AND a.is_pregnant = TRUE
      AND NOT EXISTS (
          SELECT 1 FROM ops.cat_reproductive_observations o
          WHERE o.cat_id = a.cat_id AND o.observation_type = 'pregnancy' AND o.appointment_date = a.appointment_date
      )
    ORDER BY a.cat_id, a.appointment_date;
    GET DIAGNOSTICS v_cnt = ROW_COUNT;
    v_repro := v_repro + v_cnt;

    -- Lactation
    INSERT INTO ops.cat_reproductive_observations (
        cat_id, appointment_date, observation_type, is_lactating, source_field,
        source_system, evidence_source, extraction_confidence
    )
    SELECT DISTINCT ON (a.cat_id, a.appointment_date)
        a.cat_id, a.appointment_date, 'lactation', TRUE, 'is_lactating',
        'clinichq', 'api_export_structured', 0.95
    FROM ops.appointments a
    WHERE a.cat_id IS NOT NULL AND a.is_lactating = TRUE
      AND NOT EXISTS (
          SELECT 1 FROM ops.cat_reproductive_observations o
          WHERE o.cat_id = a.cat_id AND o.observation_type = 'lactation' AND o.appointment_date = a.appointment_date
      )
    ORDER BY a.cat_id, a.appointment_date;
    GET DIAGNOSTICS v_cnt = ROW_COUNT;
    v_repro := v_repro + v_cnt;

    -- In Heat
    INSERT INTO ops.cat_reproductive_observations (
        cat_id, appointment_date, observation_type, source_field,
        source_system, evidence_source, extraction_confidence
    )
    SELECT DISTINCT ON (a.cat_id, a.appointment_date)
        a.cat_id, a.appointment_date, 'in_heat', 'is_in_heat',
        'clinichq', 'api_export_structured', 0.95
    FROM ops.appointments a
    WHERE a.cat_id IS NOT NULL AND a.is_in_heat = TRUE
      AND NOT EXISTS (
          SELECT 1 FROM ops.cat_reproductive_observations o
          WHERE o.cat_id = a.cat_id AND o.observation_type = 'in_heat' AND o.appointment_date = a.appointment_date
      )
    ORDER BY a.cat_id, a.appointment_date;
    GET DIAGNOSTICS v_cnt = ROW_COUNT;
    v_repro := v_repro + v_cnt;

    RETURN QUERY SELECT v_clinical, v_repro;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION ops.flow_appointment_observations IS
'Flows appointment boolean flags (has_uri, is_pregnant, etc.) into
ops.cat_clinical_observations and ops.cat_reproductive_observations.
Uses NOT EXISTS guards for idempotency — safe to call repeatedly.
Called inline during ingest after appointment INSERT.';
