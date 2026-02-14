\echo '=== MIG_321: January 2026 Appointment Backfill ==='
\echo 'Fixes missing owner_email on appointments from January 2026'
\echo ''

-- ============================================================================
-- PROBLEM
-- ============================================================================
-- 101 cats from January 2026 procedures have no place attribution because
-- owner_email was never backfilled from staged_records.owner_info.
-- Without owner_email, the entity linking can't match to person_identifiers
-- and create cat-place relationships.
-- ============================================================================

-- Step 1: Count affected appointments before fix
\echo 'Step 1: Counting affected appointments...'
SELECT
    COUNT(*) as total_jan_2026,
    COUNT(owner_email) as with_email,
    COUNT(*) - COUNT(owner_email) as missing_email
FROM trapper.sot_appointments
WHERE appointment_date >= '2026-01-01';

-- Step 2: Backfill owner_email from staged_records
\echo ''
\echo 'Step 2: Backfilling owner_email from staged_records...'

WITH backfill_source AS (
    SELECT
        sr.payload->>'Number' as appointment_number,
        LOWER(TRIM(sr.payload->>'Owner Email')) as owner_email,
        trapper.norm_phone_us(sr.payload->>'Owner Phone') as owner_phone,
        TRIM(sr.payload->>'Owner First Name') as owner_first_name,
        TRIM(sr.payload->>'Owner Last Name') as owner_last_name
    FROM trapper.staged_records sr
    WHERE sr.source_system = 'clinichq'
      AND sr.source_table = 'owner_info'
      AND sr.payload->>'Owner Email' IS NOT NULL
      AND sr.payload->>'Owner Email' != ''
      AND LOWER(TRIM(sr.payload->>'Owner Email')) != 'none'
)
UPDATE trapper.sot_appointments a
SET
    owner_email = bs.owner_email,
    owner_phone = COALESCE(a.owner_phone, bs.owner_phone),
    owner_name = COALESCE(a.owner_name, TRIM(bs.owner_first_name || ' ' || bs.owner_last_name)),
    updated_at = NOW()
FROM backfill_source bs
WHERE bs.appointment_number = a.appointment_number
  AND a.owner_email IS NULL
  AND a.appointment_date >= '2026-01-01';

-- Step 3: Also backfill any older appointments that might be missing
\echo ''
\echo 'Step 3: Checking for other appointments needing backfill...'

WITH backfill_source AS (
    SELECT
        sr.payload->>'Number' as appointment_number,
        LOWER(TRIM(sr.payload->>'Owner Email')) as owner_email,
        trapper.norm_phone_us(sr.payload->>'Owner Phone') as owner_phone
    FROM trapper.staged_records sr
    WHERE sr.source_system = 'clinichq'
      AND sr.source_table = 'owner_info'
      AND sr.payload->>'Owner Email' IS NOT NULL
      AND sr.payload->>'Owner Email' != ''
      AND LOWER(TRIM(sr.payload->>'Owner Email')) != 'none'
)
UPDATE trapper.sot_appointments a
SET
    owner_email = bs.owner_email,
    owner_phone = COALESCE(a.owner_phone, bs.owner_phone),
    updated_at = NOW()
FROM backfill_source bs
WHERE bs.appointment_number = a.appointment_number
  AND a.owner_email IS NULL;

-- Step 4: Run entity linking to create cat-place relationships
\echo ''
\echo 'Step 4: Running entity linking to create cat-place relationships...'
SELECT * FROM trapper.run_all_entity_linking();

-- Step 5: Verify fix
\echo ''
\echo 'Step 5: Verifying results...'
SELECT
    COUNT(*) as total_jan_2026,
    COUNT(owner_email) as with_email,
    COUNT(*) - COUNT(owner_email) as missing_email
FROM trapper.sot_appointments
WHERE appointment_date >= '2026-01-01';

-- Check cat-place coverage improvement
\echo ''
\echo 'Cat-place coverage:'
SELECT
    COUNT(*) as total_cats,
    COUNT(DISTINCT cpr.cat_id) as cats_with_places,
    ROUND(100.0 * COUNT(DISTINCT cpr.cat_id) / COUNT(*), 1) as coverage_pct
FROM trapper.sot_cats c
LEFT JOIN trapper.cat_place_relationships cpr ON cpr.cat_id = c.cat_id
WHERE c.merged_into_cat_id IS NULL;

\echo ''
\echo '=== MIG_321 Complete ==='
\echo 'Backfilled owner_email for January 2026 appointments and ran entity linking.'
\echo ''
