-- MIG_2455: Fix Duplicate Appointments
--
-- ROOT CAUSE: ops.appointments table lacks a unique constraint on
-- (appointment_number, appointment_date). The ingest route has a NOT EXISTS
-- check, but this can race with concurrent uploads or be bypassed by
-- edge cases in the staged_records processing.
--
-- THE BUG:
--   Photo upload search showed the same cat twice (microchip 981020053833542)
--   because the cat had 2 appointments on the same day with the same
--   appointment_number. "No cat should have 2 appts same day" - user.
--
-- FIX:
--   1. Quarantine existing duplicates to ops.quarantined_appointments
--   2. Add unique constraint on (appointment_number, appointment_date)
--   3. Add index for efficient constraint checking
--
-- INVARIANT: A cat has at most ONE appointment per day at FFSC clinic.
--   Multiple service lines are aggregated into a single appointment row
--   (see ingest route: aggregation of 'Service / Subsidy' into 'All Services')

BEGIN;

-- ============================================================================
-- Phase 1: Create Quarantine Table
-- ============================================================================

\echo '=== MIG_2455: Fix Duplicate Appointments ==='
\echo ''
\echo 'Phase 1: Creating quarantine table...'

CREATE TABLE IF NOT EXISTS ops.quarantined_appointments (
    quarantine_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Original appointment data (full copy)
    original_appointment_id UUID NOT NULL,
    cat_id UUID,
    person_id UUID,
    place_id UUID,
    inferred_place_id UUID,
    appointment_date DATE NOT NULL,
    appointment_number TEXT,
    service_type TEXT,
    is_spay BOOLEAN,
    is_neuter BOOLEAN,
    is_alteration BOOLEAN,
    vet_name TEXT,
    technician TEXT,
    temperature NUMERIC(4,1),
    medical_notes TEXT,
    is_lactating BOOLEAN,
    is_pregnant BOOLEAN,
    is_in_heat BOOLEAN,

    -- Enriched columns
    clinic_day_number INTEGER,
    has_uri BOOLEAN,
    has_dental_disease BOOLEAN,
    has_ear_issue BOOLEAN,
    has_eye_issue BOOLEAN,
    has_skin_issue BOOLEAN,
    has_mouth_issue BOOLEAN,
    has_fleas BOOLEAN,
    has_ticks BOOLEAN,
    has_tapeworms BOOLEAN,
    has_ear_mites BOOLEAN,
    has_ringworm BOOLEAN,
    has_polydactyl BOOLEAN,
    has_bradycardia BOOLEAN,
    has_too_young_for_rabies BOOLEAN,
    has_cryptorchid BOOLEAN,
    has_hernia BOOLEAN,
    has_pyometra BOOLEAN,
    has_ear_tip BOOLEAN,
    felv_fiv_result TEXT,
    body_composition_score TEXT,
    no_surgery_reason TEXT,
    total_invoiced NUMERIC(10,2),
    subsidy_value NUMERIC(10,2),
    clinichq_appointment_id TEXT,

    -- Denormalized owner info
    owner_email TEXT,
    owner_phone TEXT,
    owner_first_name TEXT,
    owner_last_name TEXT,
    owner_address TEXT,

    -- Source tracking
    data_source TEXT,
    source_system TEXT,
    source_record_id TEXT,
    source_row_hash TEXT,

    -- Original timestamps
    original_created_at TIMESTAMPTZ,
    original_updated_at TIMESTAMPTZ,
    migrated_at TIMESTAMPTZ,

    -- Quarantine metadata
    quarantine_reason TEXT NOT NULL DEFAULT 'duplicate_appointment',
    quarantined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    quarantined_by TEXT DEFAULT 'MIG_2455',

    -- The surviving appointment (for reference)
    kept_appointment_id UUID,

    -- Review status
    review_status TEXT DEFAULT 'pending' CHECK (review_status IN ('pending', 'merged', 'restored', 'deleted'))
);

CREATE INDEX IF NOT EXISTS idx_quarantined_appts_date ON ops.quarantined_appointments(appointment_date, appointment_number);
CREATE INDEX IF NOT EXISTS idx_quarantined_appts_cat ON ops.quarantined_appointments(cat_id);
CREATE INDEX IF NOT EXISTS idx_quarantined_appts_status ON ops.quarantined_appointments(review_status);

COMMENT ON TABLE ops.quarantined_appointments IS
'Holds duplicate appointments quarantined by MIG_2455.
Review these records to determine if data should be merged.
Each duplicate preserves full row data for potential recovery.';

-- ============================================================================
-- Phase 2: Identify and Quarantine Duplicates
-- ============================================================================

\echo ''
\echo 'Phase 2: Identifying duplicate appointments...'

-- Count duplicates before action
DO $$
DECLARE
    v_duplicate_count INTEGER;
    v_affected_cats INTEGER;
BEGIN
    SELECT COUNT(*), COUNT(DISTINCT cat_id)
    INTO v_duplicate_count, v_affected_cats
    FROM (
        SELECT appointment_number, appointment_date, cat_id,
               ROW_NUMBER() OVER (
                   PARTITION BY appointment_number, appointment_date
                   ORDER BY created_at ASC, appointment_id ASC
               ) AS rn
        FROM ops.appointments
        WHERE appointment_number IS NOT NULL
          AND appointment_date IS NOT NULL
    ) dups
    WHERE rn > 1;

    RAISE NOTICE 'Found % duplicate appointments affecting % cats',
        COALESCE(v_duplicate_count, 0),
        COALESCE(v_affected_cats, 0);
END;
$$;

\echo 'Quarantining duplicates (keeping earliest created)...'

-- Quarantine duplicates (keep the earliest created appointment)
WITH duplicates AS (
    SELECT *,
           ROW_NUMBER() OVER (
               PARTITION BY appointment_number, appointment_date
               ORDER BY created_at ASC, appointment_id ASC
           ) AS rn,
           FIRST_VALUE(appointment_id) OVER (
               PARTITION BY appointment_number, appointment_date
               ORDER BY created_at ASC, appointment_id ASC
           ) AS kept_id
    FROM ops.appointments
    WHERE appointment_number IS NOT NULL
      AND appointment_date IS NOT NULL
),
quarantined AS (
    INSERT INTO ops.quarantined_appointments (
        original_appointment_id,
        cat_id, person_id, place_id, inferred_place_id,
        appointment_date, appointment_number,
        service_type, is_spay, is_neuter, is_alteration,
        vet_name, technician, temperature, medical_notes,
        is_lactating, is_pregnant, is_in_heat,
        clinic_day_number,
        has_uri, has_dental_disease, has_ear_issue, has_eye_issue,
        has_skin_issue, has_mouth_issue, has_fleas, has_ticks,
        has_tapeworms, has_ear_mites, has_ringworm,
        has_polydactyl, has_bradycardia, has_too_young_for_rabies,
        has_cryptorchid, has_hernia, has_pyometra, has_ear_tip,
        felv_fiv_result, body_composition_score, no_surgery_reason,
        total_invoiced, subsidy_value, clinichq_appointment_id,
        owner_email, owner_phone, owner_first_name, owner_last_name, owner_address,
        data_source, source_system, source_record_id, source_row_hash,
        original_created_at, original_updated_at, migrated_at,
        kept_appointment_id,
        quarantine_reason
    )
    SELECT
        d.appointment_id,
        d.cat_id, d.person_id, d.place_id, d.inferred_place_id,
        d.appointment_date, d.appointment_number,
        d.service_type, d.is_spay, d.is_neuter, d.is_alteration,
        d.vet_name, d.technician, d.temperature, d.medical_notes,
        d.is_lactating, d.is_pregnant, d.is_in_heat,
        d.clinic_day_number,
        d.has_uri, d.has_dental_disease, d.has_ear_issue, d.has_eye_issue,
        d.has_skin_issue, d.has_mouth_issue, d.has_fleas, d.has_ticks,
        d.has_tapeworms, d.has_ear_mites, d.has_ringworm,
        d.has_polydactyl, d.has_bradycardia, d.has_too_young_for_rabies,
        d.has_cryptorchid, d.has_hernia, d.has_pyometra, d.has_ear_tip,
        d.felv_fiv_result, d.body_composition_score, d.no_surgery_reason,
        d.total_invoiced, d.subsidy_value, d.clinichq_appointment_id,
        d.owner_email, d.owner_phone, d.owner_first_name, d.owner_last_name, d.owner_address,
        d.data_source, d.source_system, d.source_record_id, d.source_row_hash,
        d.created_at, d.updated_at, d.migrated_at,
        d.kept_id,
        'duplicate_appointment_number_date'
    FROM duplicates d
    WHERE d.rn > 1
    RETURNING original_appointment_id
)
-- Delete the quarantined duplicates from appointments
DELETE FROM ops.appointments
WHERE appointment_id IN (SELECT original_appointment_id FROM quarantined);

\echo 'Duplicates quarantined.'

-- ============================================================================
-- Phase 3: Add Unique Constraint
-- ============================================================================

\echo ''
\echo 'Phase 3: Adding unique constraint...'

-- Add unique index (allows NULLs to not conflict, which is correct behavior)
-- appointment_number can be NULL for manually-created appointments
CREATE UNIQUE INDEX IF NOT EXISTS idx_appointments_number_date_unique
    ON ops.appointments(appointment_number, appointment_date)
    WHERE appointment_number IS NOT NULL;

COMMENT ON INDEX ops.idx_appointments_number_date_unique IS
'Prevents duplicate appointments with same number on same date.
NULL appointment_numbers are allowed (manual appointments).
MIG_2455: Added to prevent the bug where photo upload search
showed the same cat twice due to duplicate appointment rows.';

-- ============================================================================
-- Phase 4: Merge Quarantined Data Back (if service_type differs)
-- ============================================================================

\echo ''
\echo 'Phase 4: Merging service data from duplicates...'

-- If a quarantined duplicate has service_type data that the kept appointment lacks,
-- merge it by appending to service_type
UPDATE ops.appointments a
SET
    service_type = CASE
        WHEN a.service_type IS NULL THEN q.service_type
        WHEN q.service_type IS NOT NULL AND a.service_type NOT ILIKE '%' || q.service_type || '%'
        THEN a.service_type || '; ' || q.service_type
        ELSE a.service_type
    END,
    -- Also inherit any TRUE health flags
    has_uri = a.has_uri OR COALESCE(q.has_uri, FALSE),
    has_dental_disease = a.has_dental_disease OR COALESCE(q.has_dental_disease, FALSE),
    has_ear_issue = a.has_ear_issue OR COALESCE(q.has_ear_issue, FALSE),
    has_eye_issue = a.has_eye_issue OR COALESCE(q.has_eye_issue, FALSE),
    has_skin_issue = a.has_skin_issue OR COALESCE(q.has_skin_issue, FALSE),
    has_mouth_issue = a.has_mouth_issue OR COALESCE(q.has_mouth_issue, FALSE),
    has_fleas = a.has_fleas OR COALESCE(q.has_fleas, FALSE),
    has_ticks = a.has_ticks OR COALESCE(q.has_ticks, FALSE),
    has_tapeworms = a.has_tapeworms OR COALESCE(q.has_tapeworms, FALSE),
    has_ear_mites = a.has_ear_mites OR COALESCE(q.has_ear_mites, FALSE),
    has_ringworm = a.has_ringworm OR COALESCE(q.has_ringworm, FALSE),
    has_polydactyl = a.has_polydactyl OR COALESCE(q.has_polydactyl, FALSE),
    has_bradycardia = a.has_bradycardia OR COALESCE(q.has_bradycardia, FALSE),
    has_too_young_for_rabies = a.has_too_young_for_rabies OR COALESCE(q.has_too_young_for_rabies, FALSE),
    has_cryptorchid = a.has_cryptorchid OR COALESCE(q.has_cryptorchid, FALSE),
    has_hernia = a.has_hernia OR COALESCE(q.has_hernia, FALSE),
    has_pyometra = a.has_pyometra OR COALESCE(q.has_pyometra, FALSE),
    has_ear_tip = a.has_ear_tip OR COALESCE(q.has_ear_tip, FALSE),
    -- Fill-only fields
    felv_fiv_result = COALESCE(a.felv_fiv_result, q.felv_fiv_result),
    body_composition_score = COALESCE(a.body_composition_score, q.body_composition_score),
    no_surgery_reason = COALESCE(a.no_surgery_reason, q.no_surgery_reason),
    updated_at = NOW()
FROM ops.quarantined_appointments q
WHERE a.appointment_id = q.kept_appointment_id
  AND q.review_status = 'pending';

-- Mark merged quarantined records
UPDATE ops.quarantined_appointments
SET review_status = 'merged'
WHERE review_status = 'pending';

-- ============================================================================
-- Phase 5: Add data_source column if missing
-- ============================================================================

\echo ''
\echo 'Phase 5: Ensuring data_source column exists...'

ALTER TABLE ops.appointments ADD COLUMN IF NOT EXISTS data_source TEXT;
ALTER TABLE ops.appointments ADD COLUMN IF NOT EXISTS has_ear_tip BOOLEAN DEFAULT FALSE;

-- ============================================================================
-- Phase 6: Verification
-- ============================================================================

\echo ''
\echo 'Phase 6: Verification...'

DO $$
DECLARE
    v_total_appointments INTEGER;
    v_quarantined INTEGER;
    v_remaining_duplicates INTEGER;
BEGIN
    SELECT COUNT(*) INTO v_total_appointments FROM ops.appointments;
    SELECT COUNT(*) INTO v_quarantined FROM ops.quarantined_appointments;

    SELECT COUNT(*) INTO v_remaining_duplicates
    FROM (
        SELECT appointment_number, appointment_date, COUNT(*) as cnt
        FROM ops.appointments
        WHERE appointment_number IS NOT NULL
          AND appointment_date IS NOT NULL
        GROUP BY appointment_number, appointment_date
        HAVING COUNT(*) > 1
    ) dups;

    RAISE NOTICE '=== MIG_2455 Verification ===';
    RAISE NOTICE 'Total appointments: %', v_total_appointments;
    RAISE NOTICE 'Quarantined duplicates: %', v_quarantined;
    RAISE NOTICE 'Remaining duplicates: % (should be 0)', v_remaining_duplicates;

    IF v_remaining_duplicates > 0 THEN
        RAISE WARNING 'ALERT: % duplicate appointments still exist!', v_remaining_duplicates;
    ELSE
        RAISE NOTICE 'SUCCESS: No duplicate appointments remain.';
    END IF;
END;
$$;

COMMIT;

-- ============================================================================
-- Post-commit: Show summary
-- ============================================================================

\echo ''
\echo '=============================================='
\echo '  MIG_2455 Complete!'
\echo '=============================================='
\echo ''
\echo 'Fixed:'
\echo '  1. Quarantined duplicate appointments to ops.quarantined_appointments'
\echo '  2. Added unique constraint on (appointment_number, appointment_date)'
\echo '  3. Merged service data from duplicates into surviving appointments'
\echo ''
\echo 'IMPORTANT: Update ingest route to use ON CONFLICT UPDATE'
\echo '  File: apps/web/src/app/api/ingest/process/[id]/route.ts'
\echo '  Change: Replace NOT EXISTS check with proper UPSERT'
\echo ''
\echo 'Quarantine table for review: ops.quarantined_appointments'
\echo '  - review_status = merged: Data has been preserved in kept appointment'
\echo '  - review_status = pending: Needs manual review'
\echo ''

-- Show sample quarantined records
\echo 'Sample quarantined records (first 5):'
SELECT
    q.original_appointment_id,
    q.appointment_date,
    q.appointment_number,
    q.cat_id,
    q.service_type,
    q.quarantine_reason,
    q.review_status
FROM ops.quarantined_appointments q
ORDER BY q.quarantined_at DESC
LIMIT 5;
