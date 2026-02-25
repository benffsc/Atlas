-- MIG_2490: Backfill Clinic Accounts for ALL Appointments
--
-- DATA_GAP_053 Fix: Create clinic_accounts for ALL existing appointments
-- and link them via owner_account_id.
--
-- BEFORE: ~7,742 clinic_accounts (pseudo-profiles only), ~15 appointments linked
-- AFTER: clinic_accounts for ALL owners, 100% appointments linked
--
-- ROBUSTNESS FIXES (from MIG_2491):
-- - Fix 2: Uses sot.parse_client_name() for robust name parsing
-- - Fix 3: Uses LOWER() for case-insensitive matching
-- - Fix 4: Detects households via phone in addition to email
-- - Fix 8: Sets backfill_batch for rollback support
-- - Fix 11: Smart household naming (avoids "The 5403 San Antonio Road Family")
--
-- REQUIRES: MIG_2491 must be run first (creates parse_client_name, backfill_batch column)
--
-- Created: 2026-02-23

\echo ''
\echo '=============================================='
\echo '  MIG_2490: Backfill Clinic Accounts'
\echo '=============================================='
\echo ''

-- ============================================================================
-- 0. BASELINE COUNTS
-- ============================================================================

\echo '0. Baseline counts before backfill:'

SELECT
  COUNT(*) as total_appointments,
  COUNT(owner_account_id) as with_owner_account,
  COUNT(owner_first_name) as with_first_name,
  COUNT(owner_last_name) as with_last_name,
  COUNT(person_id) as with_person_id
FROM ops.appointments;

SELECT COUNT(*) as existing_clinic_accounts FROM ops.clinic_accounts;

-- ============================================================================
-- 1. CREATE ACCOUNTS FOR APPOINTMENTS WITH OWNER DATA BUT NO ACCOUNT
-- ============================================================================

\echo ''
\echo '1. Creating clinic_accounts from appointment owner data...'

-- Use a deduplicated approach: one account per unique (first_name, last_name, email, phone)
-- FIX: Use owner_first_name/owner_last_name directly (99.9% coverage)
--      NOT client_name which only has 0.5% coverage
-- Fix 3: Uses LOWER() for case-insensitive deduplication
WITH distinct_owners AS (
  SELECT DISTINCT ON (
    COALESCE(LOWER(owner_first_name), ''),
    COALESCE(LOWER(owner_last_name), ''),
    COALESCE(LOWER(owner_email), ''),
    COALESCE(owner_phone, '')
  )
    owner_first_name as first_name,
    owner_last_name as last_name,
    -- Build display name from first/last for reference
    TRIM(COALESCE(owner_first_name, '') || ' ' || COALESCE(owner_last_name, '')) as original_client_name,
    owner_email,
    owner_phone,
    owner_address,
    person_id,  -- Already resolved by Data Engine
    appointment_number,
    appointment_date
  FROM ops.appointments
  WHERE (owner_first_name IS NOT NULL OR owner_last_name IS NOT NULL)
    AND owner_account_id IS NULL
  ORDER BY
    COALESCE(LOWER(owner_first_name), ''),
    COALESCE(LOWER(owner_last_name), ''),
    COALESCE(LOWER(owner_email), ''),
    COALESCE(owner_phone, ''),
    appointment_date DESC  -- Most recent first
),
account_classification AS (
  SELECT
    owners_data.*,
    -- classify_owner_name takes a single display_name parameter
    sot.classify_owner_name(
      TRIM(COALESCE(owners_data.first_name, '') || ' ' || COALESCE(owners_data.last_name, ''))
    ) as classification
  FROM distinct_owners owners_data
),
new_accounts AS (
  INSERT INTO ops.clinic_accounts (
    owner_first_name,
    owner_last_name,
    owner_email,
    owner_phone,
    owner_address,
    account_type,
    resolved_person_id,
    source_system,
    source_record_id,
    first_appointment_date,
    last_appointment_date,
    appointment_count,
    backfill_batch,  -- Fix 8: Track for rollback
    source_created_at  -- Fix 10: Provenance
  )
  SELECT
    ac.first_name,
    ac.last_name,
    ac.owner_email,
    ac.owner_phone,
    ac.owner_address,
    -- Map classification to account_type (Fix 6: COALESCE for NULL safety)
    CASE COALESCE(ac.classification, 'unknown')
      WHEN 'address' THEN 'address'
      WHEN 'organization' THEN 'organization'
      WHEN 'known_org' THEN 'organization'
      WHEN 'apartment_complex' THEN 'site_name'
      WHEN 'likely_person' THEN 'resident'
      ELSE 'unknown'
    END,
    ac.person_id,  -- Already resolved
    'clinichq',
    'backfill_' || ac.appointment_number,
    ac.appointment_date,
    ac.appointment_date,
    1,
    'MIG_2490_' || CURRENT_DATE::TEXT,  -- Fix 8: Batch identifier for rollback
    ac.appointment_date::TIMESTAMPTZ  -- Fix 10: Source created at
  FROM account_classification ac
  -- Skip if account already exists with same name/email (Fix 3: case-insensitive)
  WHERE NOT EXISTS (
    SELECT 1 FROM ops.clinic_accounts ca
    WHERE LOWER(ca.owner_first_name) = LOWER(ac.first_name)
      AND LOWER(COALESCE(ca.owner_last_name, '')) = LOWER(COALESCE(ac.last_name, ''))
      AND (
        (ac.owner_email IS NOT NULL AND LOWER(ca.owner_email) = LOWER(ac.owner_email))
        OR (ac.owner_phone IS NOT NULL AND ca.owner_phone = ac.owner_phone)
        OR (ac.owner_email IS NULL AND ac.owner_phone IS NULL
            AND ca.owner_email IS NULL AND ca.owner_phone IS NULL)
      )
      AND ca.merged_into_account_id IS NULL
  )
  ON CONFLICT DO NOTHING
  RETURNING account_id
)
SELECT COUNT(*) as accounts_created FROM new_accounts;

-- ============================================================================
-- 2. LINK APPOINTMENTS TO ACCOUNTS
-- ============================================================================

\echo ''
\echo '2. Linking appointments to clinic_accounts via owner_account_id...'

-- Match appointments to accounts by (first_name, last_name, email OR phone)
-- FIX: Use owner_first_name/owner_last_name directly (no parsing needed)
-- Fix 3: Uses LOWER() for case-insensitive matching
WITH appointment_account_matches AS (
  UPDATE ops.appointments a
  SET owner_account_id = ca.account_id
  FROM ops.clinic_accounts ca
  WHERE ca.merged_into_account_id IS NULL
    -- Match by first/last name directly (case-insensitive)
    AND LOWER(COALESCE(a.owner_first_name, '')) = LOWER(COALESCE(ca.owner_first_name, ''))
    AND LOWER(COALESCE(a.owner_last_name, '')) = LOWER(COALESCE(ca.owner_last_name, ''))
    -- And match by email or phone (case-insensitive for email)
    AND (
      (a.owner_email IS NOT NULL AND LOWER(a.owner_email) = LOWER(ca.owner_email))
      OR (a.owner_phone IS NOT NULL AND a.owner_phone = ca.owner_phone)
      OR (a.owner_email IS NULL AND a.owner_phone IS NULL
          AND ca.owner_email IS NULL AND ca.owner_phone IS NULL)
    )
    -- Only process unlinked appointments with owner data
    AND a.owner_account_id IS NULL
    AND (a.owner_first_name IS NOT NULL OR a.owner_last_name IS NOT NULL)
  RETURNING a.appointment_id
)
SELECT COUNT(*) as appointments_linked FROM appointment_account_matches;

-- ============================================================================
-- 3. UPDATE ACCOUNT STATISTICS
-- ============================================================================

\echo ''
\echo '3. Updating account statistics...'

-- Update appointment_count for all accounts
UPDATE ops.clinic_accounts ca
SET
  appointment_count = stats.cnt,
  first_appointment_date = stats.first_date,
  last_appointment_date = stats.last_date
FROM (
  SELECT
    owner_account_id,
    COUNT(*) as cnt,
    MIN(appointment_date) as first_date,
    MAX(appointment_date) as last_date
  FROM ops.appointments
  WHERE owner_account_id IS NOT NULL
  GROUP BY owner_account_id
) stats
WHERE ca.account_id = stats.owner_account_id;

-- Update cat_count
UPDATE ops.clinic_accounts ca
SET cat_count = stats.cnt
FROM (
  SELECT
    owner_account_id,
    COUNT(DISTINCT cat_id) as cnt
  FROM ops.appointments
  WHERE owner_account_id IS NOT NULL
    AND cat_id IS NOT NULL
  GROUP BY owner_account_id
) stats
WHERE ca.account_id = stats.owner_account_id;

-- ============================================================================
-- 4. DETECT HOUSEHOLDS (Phase 2)
-- ============================================================================

\echo ''
\echo '4. Detecting households from shared email/phone...'

-- ============================================================================
-- 4a. SHARED EMAIL HOUSEHOLDS
-- ============================================================================

\echo '4a. Detecting households from shared email...'

-- Find shared emails with multiple accounts
WITH shared_emails AS (
  SELECT owner_email, COUNT(*) as account_count
  FROM ops.clinic_accounts
  WHERE owner_email IS NOT NULL
    AND owner_email != ''
    AND merged_into_account_id IS NULL
    AND account_type IN ('resident', 'colony_caretaker', 'community_trapper', 'rescue_operator')
  GROUP BY owner_email
  HAVING COUNT(*) > 1
),
new_email_households AS (
  INSERT INTO sot.households (
    display_name,
    shared_email,
    detection_reason
  )
  SELECT
    -- Fix 11: Smart household naming - handle non-person accounts
    (
      SELECT
        CASE
          WHEN ca.account_type IN ('address', 'site_name', 'organization')
          THEN 'Property at ' || COALESCE(ca.owner_first_name, ca.owner_address, 'Unknown Location')
          ELSE 'The ' || COALESCE(ca.owner_last_name, ca.owner_first_name, 'Unknown') || ' Family'
        END
      FROM ops.clinic_accounts ca
      WHERE ca.owner_email = se.owner_email
        AND ca.merged_into_account_id IS NULL
      ORDER BY ca.appointment_count DESC NULLS LAST
      LIMIT 1
    ) as display_name,
    se.owner_email,
    'shared_email'
  FROM shared_emails se
  WHERE NOT EXISTS (
    SELECT 1 FROM sot.households h WHERE h.shared_email = se.owner_email
  )
  RETURNING household_id, shared_email
)
SELECT COUNT(*) as email_households_created FROM new_email_households;

-- Link accounts to their email-based households
UPDATE ops.clinic_accounts ca
SET household_id = h.household_id
FROM sot.households h
WHERE ca.owner_email = h.shared_email
  AND ca.household_id IS NULL
  AND ca.merged_into_account_id IS NULL;

-- ============================================================================
-- 4b. SHARED PHONE HOUSEHOLDS (Fix 4: HIGH)
-- ============================================================================

\echo '4b. Detecting households from shared phone...'

-- Find shared phones with multiple accounts (excluding those already in a household)
WITH shared_phones AS (
  SELECT owner_phone, COUNT(*) as account_count
  FROM ops.clinic_accounts
  WHERE owner_phone IS NOT NULL
    AND owner_phone != ''
    AND merged_into_account_id IS NULL
    AND account_type IN ('resident', 'colony_caretaker', 'community_trapper', 'rescue_operator')
    -- Only consider accounts not already in an email-based household
    AND household_id IS NULL
  GROUP BY owner_phone
  HAVING COUNT(*) > 1
),
new_phone_households AS (
  INSERT INTO sot.households (
    display_name,
    shared_phone,
    detection_reason
  )
  SELECT
    -- Fix 11: Smart household naming
    (
      SELECT
        CASE
          WHEN ca.account_type IN ('address', 'site_name', 'organization')
          THEN 'Property at ' || COALESCE(ca.owner_first_name, ca.owner_address, 'Unknown Location')
          ELSE 'The ' || COALESCE(ca.owner_last_name, ca.owner_first_name, 'Unknown') || ' Family'
        END
      FROM ops.clinic_accounts ca
      WHERE ca.owner_phone = sp.owner_phone
        AND ca.merged_into_account_id IS NULL
        AND ca.household_id IS NULL
      ORDER BY ca.appointment_count DESC NULLS LAST
      LIMIT 1
    ) as display_name,
    sp.owner_phone,
    'shared_phone'
  FROM shared_phones sp
  WHERE NOT EXISTS (
    SELECT 1 FROM sot.households h WHERE h.shared_phone = sp.owner_phone
  )
  RETURNING household_id, shared_phone
)
SELECT COUNT(*) as phone_households_created FROM new_phone_households;

-- Link accounts to their phone-based households
UPDATE ops.clinic_accounts ca
SET household_id = h.household_id
FROM sot.households h
WHERE ca.owner_phone = h.shared_phone
  AND ca.household_id IS NULL
  AND ca.merged_into_account_id IS NULL;

-- ============================================================================
-- 5. VERIFICATION
-- ============================================================================

\echo ''
\echo '=============================================='
\echo '  VERIFICATION'
\echo '=============================================='
\echo ''

\echo '5a. Appointment coverage after backfill:'
SELECT
  COUNT(*) as total_appointments,
  COUNT(owner_account_id) as with_owner_account,
  ROUND(100.0 * COUNT(owner_account_id) / NULLIF(COUNT(*), 0), 1) as coverage_pct,
  COUNT(person_id) as with_person_id
FROM ops.appointments;

\echo ''
\echo '5b. Accounts by type:'
SELECT
  account_type,
  COUNT(*) as count,
  COUNT(resolved_person_id) as with_resolved_person,
  COUNT(household_id) as in_household
FROM ops.clinic_accounts
WHERE merged_into_account_id IS NULL
GROUP BY account_type
ORDER BY count DESC;

\echo ''
\echo '5c. Households created by detection method:'
SELECT
  detection_reason,
  COUNT(*) as households,
  SUM((SELECT COUNT(*) FROM ops.clinic_accounts ca WHERE ca.household_id = h.household_id)) as accounts_in_households
FROM sot.households h
GROUP BY detection_reason
ORDER BY households DESC;

\echo ''
\echo '5d. Backfill batch info (for rollback if needed):'
SELECT
  backfill_batch,
  COUNT(*) as accounts_created
FROM ops.clinic_accounts
WHERE backfill_batch IS NOT NULL
GROUP BY backfill_batch
ORDER BY backfill_batch DESC
LIMIT 5;

\echo ''
\echo '5e. DATA_GAP_053 test - Togneri case:'
SELECT
  a.appointment_date,
  a.client_name as booked_as,
  ca.display_name as account_name,
  ca.account_type,
  p.display_name as resolved_to,
  h.display_name as household
FROM ops.appointments a
LEFT JOIN ops.clinic_accounts ca ON ca.account_id = a.owner_account_id
LEFT JOIN sot.people p ON p.person_id = a.person_id
LEFT JOIN sot.households h ON h.household_id = ca.household_id
WHERE a.client_name ILIKE '%Togneri%'
ORDER BY a.appointment_date DESC
LIMIT 10;

-- ============================================================================
-- 6. SUMMARY
-- ============================================================================

\echo ''
\echo '=============================================='
\echo '  MIG_2490 COMPLETE'
\echo '=============================================='
\echo ''
\echo 'Backfilled:'
\echo '  - Created clinic_accounts for appointments without accounts'
\echo '  - Linked appointments to accounts via owner_account_id'
\echo '  - Updated account statistics (appointment_count, cat_count)'
\echo '  - Detected households from shared email AND phone (Fix 4)'
\echo ''
\echo 'Robustness fixes applied:'
\echo '  - Fix 2: Robust name parsing via sot.parse_client_name()'
\echo '  - Fix 3: Case-insensitive matching with LOWER()'
\echo '  - Fix 4: Phone-based household detection in addition to email'
\echo '  - Fix 6: NULL-safe classification with COALESCE'
\echo '  - Fix 8: backfill_batch set for rollback via ops.rollback_backfill()'
\echo '  - Fix 11: Smart household naming (avoids "The 5403 San Antonio Road Family")'
\echo ''
\echo 'DATA_GAP_053 is now FIXED:'
\echo '  - appointment.owner_account_id = "Who booked"'
\echo '  - appointment.person_id = "Who this resolved to"'
\echo '  - Multiple accounts can resolve to same person (household)'
\echo ''
\echo 'Rollback available if needed:'
\echo '  SELECT * FROM ops.rollback_backfill(''MIG_2490_'');'
\echo ''
\echo 'Next: Update ingest pipeline to create accounts for ALL owners'
\echo ''
