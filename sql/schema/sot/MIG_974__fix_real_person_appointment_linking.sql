-- MIG_974: Fix Real Person Appointment Linking
--
-- Problem: link_appointments_to_owners() processes appointments by appointment_id order,
-- which means org emails (info@forgottenfelines.com) get processed first, leaving real
-- person emails unlinked. There are 2,621 appointments with real person emails needing linking.
--
-- Root Cause: The function uses LIMIT 2000 without any email filtering or prioritization.
-- Org emails like info@forgottenfelines.com are correctly rejected by should_be_person(),
-- but they consume the LIMIT quota before real person appointments get processed.
--
-- Fix: Process appointments that DON'T have org emails first.
--
-- Related: DATA_GAP in docs/DATA_GAPS.md
-- Date: 2026-02-10

\echo '=== MIG_974: Fix Real Person Appointment Linking ==='
\echo ''

-- Step 1: Link appointments with real person emails to people
\echo 'Step 1: Linking appointments with real person emails...'

WITH appts_needing_persons AS (
    SELECT DISTINCT
      a.appointment_id,
      a.owner_email,
      a.owner_phone,
      a.appointment_number
    FROM trapper.sot_appointments a
    WHERE a.owner_email IS NOT NULL
      AND a.person_id IS NULL
      -- Skip org emails
      AND a.owner_email NOT LIKE '%forgottenfelines%'
      AND a.owner_email NOT LIKE '%ffsc%'
      AND a.owner_email NOT IN (
        SELECT identifier_norm FROM trapper.data_engine_soft_blacklist
        WHERE identifier_type = 'email'
      )
    LIMIT 3000  -- Process in batches
),
person_links AS (
    SELECT
      anp.appointment_id,
      anp.owner_email,
      trapper.find_or_create_person(
        anp.owner_email,
        anp.owner_phone,
        sr.payload->>'Owner First Name',
        sr.payload->>'Owner Last Name',
        sr.payload->>'Owner Address',
        'clinichq'
      ) AS person_id
    FROM appts_needing_persons anp
    LEFT JOIN trapper.staged_records sr ON
        sr.source_system = 'clinichq'
        AND sr.source_table = 'owner_info'
        AND sr.payload->>'Number' = anp.appointment_number
),
updates AS (
    UPDATE trapper.sot_appointments a
    SET person_id = pl.person_id
    FROM person_links pl
    WHERE a.appointment_id = pl.appointment_id
      AND pl.person_id IS NOT NULL
    RETURNING a.appointment_id, a.owner_email
)
SELECT 'Appointments linked: ' || COUNT(*)::TEXT as result FROM updates;

-- Step 2: Create person-cat relationships from newly linked appointments
\echo ''
\echo 'Step 2: Creating person-cat relationships...'

WITH missing_rels AS (
    INSERT INTO trapper.person_cat_relationships (
      person_id, cat_id, relationship_type, confidence,
      source_system, source_table
    )
    SELECT DISTINCT a.person_id, a.cat_id, 'caretaker', 'high',
      'clinichq', 'appointments'
    FROM trapper.sot_appointments a
    WHERE a.person_id IS NOT NULL
      AND a.cat_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM trapper.person_cat_relationships pcr
        WHERE pcr.person_id = a.person_id AND pcr.cat_id = a.cat_id
      )
    ON CONFLICT (person_id, cat_id, relationship_type, source_system, source_table) DO NOTHING
    RETURNING person_id, cat_id
)
SELECT 'Person-cat relationships created: ' || COUNT(*)::TEXT as result FROM missing_rels;

-- Step 3: Report remaining unlinked
\echo ''
\echo 'Step 3: Remaining unlinked appointments...'

SELECT
    CASE
        WHEN owner_email LIKE '%forgottenfelines%' THEN 'FFSC org (expected)'
        ELSE 'Real person (needs another run)'
    END as email_type,
    COUNT(*) as count
FROM trapper.sot_appointments
WHERE owner_email IS NOT NULL
  AND person_id IS NULL
GROUP BY 1
ORDER BY count DESC;

-- Step 4: Backfill client_name for appointments missing it
\echo ''
\echo 'Step 4: Backfilling client_name...'

WITH backfill AS (
  UPDATE trapper.sot_appointments a
  SET
    client_name = NULLIF(TRIM(
      COALESCE(NULLIF(TRIM(own_sr.payload->>'Owner First Name'), ''), '') || ' ' ||
      COALESCE(NULLIF(TRIM(own_sr.payload->>'Owner Last Name'), ''), '')
    ), '')
  FROM trapper.staged_records own_sr
  WHERE own_sr.source_system = 'clinichq'
    AND own_sr.source_table = 'owner_info'
    AND own_sr.payload->>'Number' = a.appointment_number
    AND a.client_name IS NULL
    AND (own_sr.payload->>'Owner First Name' IS NOT NULL OR own_sr.payload->>'Owner Last Name' IS NOT NULL)
  RETURNING a.appointment_id
)
SELECT 'Client names backfilled: ' || COUNT(*)::TEXT as result FROM backfill;

\echo ''
\echo '=== MIG_974 Complete ==='
\echo ''
\echo 'NOTE: Run this migration multiple times until all real person appointments are linked.'
\echo 'FFSC org emails will remain unlinked (correct behavior - they are not people).'
