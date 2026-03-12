-- MIG_2915: Backfill weight/age from cat_info + fix Unilateral cryptorchid (FFS-477, FFS-478)
--
-- Two bugs caused data loss during live ClinicHQ uploads:
--
-- 1. FFS-477: Weight/age enrichment used ci.file_upload_id = $1 where $1 was
--    the appointment_info upload_id, but cat_info has a DIFFERENT upload_id in
--    the same batch. Result: 0 weight/age enriched on ALL live uploads (296 weight,
--    343 age recoverable from staged_records).
--
-- 2. FFS-478: is_positive_value() didn't recognize 'Unilateral' as positive.
--    3 cryptorchid appointments have has_cryptorchid=FALSE when it should be TRUE.
--
-- Recovery steps:
--   Step 1: Backfill weight/age on appointments from cat_info staged_records
--   Step 2: Fix has_cryptorchid on 3 Unilateral appointments
--   Step 3: Re-run flow_appointment_observations() for new cryptorchid observations
--   Step 4: Re-run sync_cats_from_appointments() to propagate weight/age to sot.cats

-- ============================================================================
-- Step 1: Backfill weight + age from cat_info staged_records
-- ============================================================================

-- Weight backfill
WITH updated_weight AS (
  UPDATE ops.appointments a
  SET
    cat_weight_lbs = (ci.payload->>'Weight')::NUMERIC(5,2),
    updated_at = NOW()
  FROM ops.staged_records ci
  WHERE ci.source_system = 'clinichq'
    AND ci.source_table = 'cat_info'
    AND ci.payload->>'Weight' ~ '^[0-9]+\.?[0-9]*$'
    AND ci.payload->>'Microchip Number' = SPLIT_PART(a.clinichq_appointment_id, '_', 2)
    AND TO_DATE(ci.payload->>'Date', 'MM/DD/YYYY') = a.appointment_date
    AND a.cat_weight_lbs IS NULL
    AND a.source_system = 'clinichq'
  RETURNING a.appointment_id
)
SELECT COUNT(*) AS weight_backfilled FROM updated_weight;

-- Age Years backfill
WITH updated_age_years AS (
  UPDATE ops.appointments a
  SET
    cat_age_years = (ci.payload->>'Age Years')::INTEGER,
    updated_at = NOW()
  FROM ops.staged_records ci
  WHERE ci.source_system = 'clinichq'
    AND ci.source_table = 'cat_info'
    AND ci.payload->>'Age Years' ~ '^[0-9]+$'
    AND ci.payload->>'Microchip Number' = SPLIT_PART(a.clinichq_appointment_id, '_', 2)
    AND TO_DATE(ci.payload->>'Date', 'MM/DD/YYYY') = a.appointment_date
    AND a.cat_age_years IS NULL
    AND a.source_system = 'clinichq'
  RETURNING a.appointment_id
)
SELECT COUNT(*) AS age_years_backfilled FROM updated_age_years;

-- Age Months backfill (with ROUND for decimal values like 4.5, 5.5)
WITH updated_age_months AS (
  UPDATE ops.appointments a
  SET
    cat_age_months = ROUND((ci.payload->>'Age Months')::NUMERIC)::INTEGER,
    updated_at = NOW()
  FROM ops.staged_records ci
  WHERE ci.source_system = 'clinichq'
    AND ci.source_table = 'cat_info'
    AND ci.payload->>'Age Months' ~ '^[0-9]+\.?[0-9]*$'
    AND ci.payload->>'Microchip Number' = SPLIT_PART(a.clinichq_appointment_id, '_', 2)
    AND TO_DATE(ci.payload->>'Date', 'MM/DD/YYYY') = a.appointment_date
    AND a.cat_age_months IS NULL
    AND a.source_system = 'clinichq'
  RETURNING a.appointment_id
)
SELECT COUNT(*) AS age_months_backfilled FROM updated_age_months;

-- ============================================================================
-- Step 2: Fix has_cryptorchid for 'Unilateral' cases
-- ============================================================================
-- MIG_2914 already fixed is_positive_value(), but appointments were created
-- with has_cryptorchid=FALSE. Fix them now.
WITH fixed_crypto AS (
  UPDATE ops.appointments a
  SET has_cryptorchid = TRUE, updated_at = NOW()
  FROM ops.staged_records sr
  WHERE sr.source_system = 'clinichq'
    AND sr.source_table = 'appointment_info'
    AND LOWER(TRIM(sr.payload->>'Cryptorchid')) = 'unilateral'
    AND a.clinichq_appointment_id =
        TO_CHAR(TO_DATE(sr.payload->>'Date', 'MM/DD/YYYY'), 'YYYY-MM-DD')
        || '_' || (sr.payload->>'Microchip Number')
    AND a.has_cryptorchid = FALSE
  RETURNING a.appointment_id, a.clinichq_appointment_id
)
SELECT COUNT(*) AS cryptorchid_fixed FROM fixed_crypto;

-- ============================================================================
-- Step 3: Re-run flow_appointment_observations() to create missing observations
-- ============================================================================
SELECT * FROM ops.flow_appointment_observations();

-- ============================================================================
-- Step 4: Re-run sync_cats_from_appointments() to propagate weight/age to sot.cats
-- ============================================================================
SELECT * FROM ops.sync_cats_from_appointments();
