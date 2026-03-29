-- MIG_2989: Rebook Tracking View
--
-- FFS-862: Cats rebooked from one clinic day to another are invisible on the
-- original day. appointment_info only has the actual procedure date, but cat_info
-- has both the original and rebooked dates. This view identifies rebooked cats
-- so the clinic day UI can show them with a "(rebooked to MM/DD)" indicator.
--
-- Created: 2026-03-26

\echo ''
\echo '=============================================='
\echo '  MIG_2989: Rebook Tracking View'
\echo '=============================================='
\echo ''

-- ============================================================================
-- 1. CREATE REBOOKED CATS VIEW
-- ============================================================================

\echo '1. Creating ops.v_rebooked_cats...'

CREATE OR REPLACE VIEW ops.v_rebooked_cats AS
WITH cat_info_dates AS (
    -- Get all dates a cat appears in cat_info staged records
    SELECT
        sr.payload->>'Number' AS animal_number,
        TO_DATE(sr.payload->>'Date', 'MM/DD/YYYY') AS cat_info_date,
        sr.created_at AS staged_at
    FROM ops.staged_records sr
    WHERE sr.source_table = 'cat_info'
      AND sr.source_system = 'clinichq'
      AND sr.payload->>'Date' IS NOT NULL
      AND sr.payload->>'Number' IS NOT NULL
),
appointment_dates AS (
    -- Get actual appointment dates from ops.appointments
    SELECT
        a.appointment_number,
        a.appointment_date,
        a.cat_id,
        a.appointment_id,
        a.clinic_day_number,
        a.person_id,
        a.owner_account_id,
        a.inferred_place_id,
        a.place_id,
        a.owner_address,
        a.service_type,
        a.is_spay,
        a.is_neuter,
        a.cat_weight_lbs
    FROM ops.appointments a
)
SELECT
    cid.animal_number,
    cid.cat_info_date AS original_date,
    ad.appointment_date AS rebooked_to_date,
    ad.appointment_id,
    ad.cat_id,
    ad.clinic_day_number,
    ad.person_id,
    ad.owner_account_id,
    ad.inferred_place_id,
    ad.place_id,
    ad.owner_address,
    ad.service_type,
    ad.is_spay,
    ad.is_neuter,
    ad.cat_weight_lbs
FROM cat_info_dates cid
JOIN appointment_dates ad ON ad.appointment_number = cid.animal_number
WHERE cid.cat_info_date != ad.appointment_date
  -- The cat_info_date is BEFORE the actual appointment (rebook forward)
  AND cid.cat_info_date < ad.appointment_date
  -- The cat was NOT actually seen on the original date
  AND NOT EXISTS (
      SELECT 1 FROM ops.appointments a2
      WHERE a2.appointment_number = cid.animal_number
        AND a2.appointment_date = cid.cat_info_date
  );

COMMENT ON VIEW ops.v_rebooked_cats IS
'FFS-862: Shows cats that were rebooked from one clinic day to another.
Identified by cat_info having a date different from appointment_info.
Use original_date to find which clinic day they disappeared from,
rebooked_to_date to show where they went.';

-- ============================================================================
-- VERIFICATION
-- ============================================================================

\echo ''
\echo 'Verification...'

DO $$
DECLARE
    v_count INT;
BEGIN
    SELECT COUNT(*) INTO v_count FROM ops.v_rebooked_cats;
    RAISE NOTICE 'Found % rebooked cat entries', v_count;
END $$;

\echo ''
\echo 'Sample rebooked cats:'
SELECT original_date, rebooked_to_date, animal_number, cat_id
FROM ops.v_rebooked_cats
ORDER BY original_date DESC
LIMIT 10;

\echo ''
\echo '=============================================='
\echo '  MIG_2989 COMPLETE'
\echo '=============================================='
\echo ''
