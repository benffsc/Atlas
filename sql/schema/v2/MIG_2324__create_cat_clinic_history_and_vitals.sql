-- ============================================================================
-- MIG_2324: Create v_cat_clinic_history and populate cat_vitals
-- ============================================================================
-- Issue: Cat detail page shows empty appointments and no weight/vitals because:
--   1. sot.v_cat_clinic_history view doesn't exist
--   2. ops.cat_vitals table is empty (not populated from appointments)
--
-- This migration:
--   1. Creates sot.v_cat_clinic_history view for clinic history display
--   2. Populates ops.cat_vitals from ops.appointments data
--   3. Merges duplicate ShelterLuv cats (sl_animal_ prefix duplicates)
--
-- Usage: psql -f MIG_2324__create_cat_clinic_history_and_vitals.sql
-- ============================================================================

\echo '=== MIG_2324: Create v_cat_clinic_history and populate cat_vitals ==='
\echo ''

BEGIN;

-- ============================================================================
-- Phase 1: Create sot.v_cat_clinic_history view
-- ============================================================================

\echo 'Phase 1: Creating sot.v_cat_clinic_history view...'

CREATE OR REPLACE VIEW sot.v_cat_clinic_history AS
SELECT
    a.cat_id,
    a.appointment_date,
    a.appointment_number as appt_number,
    -- Client info (who brought the cat)
    COALESCE(
        p.display_name,
        TRIM(CONCAT_WS(' ', a.owner_first_name, a.owner_last_name)),
        'Unknown'
    ) as client_name,
    COALESCE(pl.formatted_address, a.owner_address) as client_address,
    COALESCE(a.owner_email, '') as client_email,
    COALESCE(a.owner_phone, '') as client_phone,
    a.ownership_type,
    -- Service info
    a.service_type,
    a.is_spay,
    a.is_neuter,
    a.is_alteration,
    a.vet_name,
    a.technician,
    -- Health data
    a.cat_weight_lbs as weight_lbs,
    a.temperature,
    a.medical_notes,
    -- Flags
    a.is_lactating,
    a.is_pregnant,
    a.is_in_heat,
    a.has_uri,
    a.has_dental_disease,
    a.has_ear_issue,
    a.has_eye_issue,
    a.has_skin_issue,
    a.has_fleas,
    a.has_ticks,
    a.felv_fiv_result
FROM ops.appointments a
LEFT JOIN sot.people p ON p.person_id = a.person_id AND p.merged_into_person_id IS NULL
LEFT JOIN sot.places pl ON pl.place_id = COALESCE(a.inferred_place_id, a.place_id) AND pl.merged_into_place_id IS NULL
WHERE a.cat_id IS NOT NULL;

COMMENT ON VIEW sot.v_cat_clinic_history IS
'Cat clinic history for display on cat detail page.
Includes client info, services, and health data from each appointment.';

\echo 'Created sot.v_cat_clinic_history view'

-- ============================================================================
-- Phase 2: Populate ops.cat_vitals from appointments
-- ============================================================================

\echo ''
\echo 'Phase 2: Populating ops.cat_vitals from appointments...'

-- Clear existing vitals (if any) to avoid duplicates
TRUNCATE ops.cat_vitals;

INSERT INTO ops.cat_vitals (
    vital_id,
    cat_id,
    appointment_id,
    recorded_at,
    temperature_f,
    weight_lbs,
    body_score,
    is_pregnant,
    is_lactating,
    is_in_heat,
    source_system,
    source_record_id,
    created_at
)
SELECT
    gen_random_uuid() as vital_id,
    a.cat_id,
    a.appointment_id,
    a.appointment_date::TIMESTAMPTZ as recorded_at,
    a.temperature as temperature_f,
    a.cat_weight_lbs as weight_lbs,
    a.body_composition_score as body_score,
    COALESCE(a.is_pregnant, FALSE) as is_pregnant,
    COALESCE(a.is_lactating, FALSE) as is_lactating,
    COALESCE(a.is_in_heat, FALSE) as is_in_heat,
    a.source_system,
    a.source_record_id,
    NOW() as created_at
FROM ops.appointments a
WHERE a.cat_id IS NOT NULL
  AND (a.temperature IS NOT NULL OR a.cat_weight_lbs IS NOT NULL);

-- ============================================================================
-- Phase 3: Merge duplicate ShelterLuv cats (sl_animal_ prefix duplicates)
-- ============================================================================

\echo ''
\echo 'Phase 3: Merging duplicate ShelterLuv cats...'

-- Find cats where one has sl_animal_ prefix and another doesn't for same FFSC-A number
WITH duplicate_pairs AS (
    SELECT
        c1.cat_id as keep_cat_id,
        c2.cat_id as merge_cat_id,
        c1.shelterluv_animal_id as keep_id,
        c2.shelterluv_animal_id as merge_id,
        c1.name as cat_name
    FROM sot.cats c1
    JOIN sot.cats c2 ON (
        -- Same FFSC-A number, different prefix
        REPLACE(c1.shelterluv_animal_id, 'sl_animal_', '') = c2.shelterluv_animal_id
        AND c1.shelterluv_animal_id LIKE 'sl_animal_%'
        AND c2.shelterluv_animal_id NOT LIKE 'sl_animal_%'
    )
    WHERE c1.source_system = 'shelterluv'
      AND c2.source_system = 'shelterluv'
      AND c1.merged_into_cat_id IS NULL
      AND c2.merged_into_cat_id IS NULL
)
UPDATE sot.cats c
SET
    merged_into_cat_id = d.keep_cat_id,
    updated_at = NOW()
FROM duplicate_pairs d
WHERE c.cat_id = d.merge_cat_id;

-- ============================================================================
-- Phase 4: Verification
-- ============================================================================

\echo ''
\echo 'Phase 4: Verification...'

DO $$
DECLARE
    v_vitals_count INTEGER;
    v_history_count INTEGER;
    v_merged_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO v_vitals_count FROM ops.cat_vitals;
    SELECT COUNT(*) INTO v_history_count FROM sot.v_cat_clinic_history;
    SELECT COUNT(*) INTO v_merged_count FROM sot.cats WHERE merged_into_cat_id IS NOT NULL AND source_system = 'shelterluv';

    RAISE NOTICE '=== MIG_2324 Verification ===';
    RAISE NOTICE 'ops.cat_vitals records: %', v_vitals_count;
    RAISE NOTICE 'sot.v_cat_clinic_history records: %', v_history_count;
    RAISE NOTICE 'ShelterLuv cats merged (duplicates): %', v_merged_count;
END;
$$;

\echo ''
\echo 'Sample vitals:'
SELECT cat_id, recorded_at::DATE, weight_lbs, temperature_f
FROM ops.cat_vitals
WHERE weight_lbs IS NOT NULL
LIMIT 5;

COMMIT;

\echo ''
\echo '=============================================='
\echo 'MIG_2324 Complete!'
\echo '=============================================='
\echo ''
\echo 'Changes made:'
\echo '  1. Created sot.v_cat_clinic_history view'
\echo '  2. Populated ops.cat_vitals from appointments (weight, temp, etc.)'
\echo '  3. Merged duplicate ShelterLuv cats'
\echo ''
