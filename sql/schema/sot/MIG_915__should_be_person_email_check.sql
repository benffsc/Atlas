-- ============================================================================
-- MIG_915: Should Be Person Email Check (DATA_GAP_009)
-- ============================================================================
-- Problem: should_be_person() only checks NAME patterns, not EMAIL patterns.
--          ClinicHQ processing calls find_or_create_person() before Data Engine
--          can reject organizational emails.
--
-- Impact:
--   - Sandra Brady: 1,253 cats linked via info@forgottenfelines.com
--   - Sandra Nicander: 1,171 cats linked via org email matching
--
-- Root Cause:
--   process_clinichq_owner_info() → should_be_person() → find_or_create_person()
--   The routing decision happens BEFORE Data Engine email rejection checks.
--
-- Solution:
--   1. Add email pattern checking to should_be_person()
--   2. Add FFSC organizational emails to soft blacklist
--   3. Check soft blacklist at the routing gate, not just scoring
--
-- New Invariants:
--   INV-17: Organizational emails must not create person records
--   INV-18: Location names must not create person records
-- ============================================================================

\echo '=== MIG_915: Should Be Person Email Check ==='
\echo ''

-- ============================================================================
-- Phase 1: Add FFSC Emails to Soft Blacklist
-- ============================================================================

\echo 'Phase 1: Adding FFSC organizational emails to soft blacklist...'

INSERT INTO trapper.data_engine_soft_blacklist (
  identifier_norm,
  identifier_type,
  reason,
  require_name_similarity,
  require_address_match,
  distinct_name_count,
  sample_names,
  auto_detected
) VALUES
  ('info@forgottenfelines.com', 'email',
   'FFSC general org email - 3,167 appointments use this - DATA_GAP_009',
   0.99, true, 50, ARRAY['Sandra Brady', 'Various staff'], false),
  ('sandra@forgottenfelines.com', 'email',
   'FFSC staff email - should not link to outside people - DATA_GAP_009',
   0.99, true, 1, ARRAY['Sandra Nicander'], false),
  ('addie@forgottenfelines.com', 'email',
   'FFSC staff email - DATA_GAP_009',
   0.99, true, 1, ARRAY['Addie'], false),
  ('julie@forgottenfelines.com', 'email',
   'FFSC staff email - DATA_GAP_009',
   0.99, true, 1, ARRAY['Julie'], false),
  ('jami@forgottenfelines.com', 'email',
   'FFSC staff email - DATA_GAP_009',
   0.99, true, 1, ARRAY['Jami'], false),
  ('espanol@forgottenfelines.com', 'email',
   'FFSC org email for Spanish outreach - DATA_GAP_009',
   0.99, true, 5, ARRAY['Various staff'], false),
  ('pip@forgottenfelines.com', 'email',
   'FFSC staff email - DATA_GAP_009',
   0.99, true, 1, ARRAY['Pip'], false),
  ('diane@forgottenfelines.com', 'email',
   'FFSC staff email - DATA_GAP_009',
   0.99, true, 1, ARRAY['Diane'], false),
  ('bita@forgottenfelines.com', 'email',
   'FFSC staff email - DATA_GAP_009',
   0.99, true, 1, ARRAY['Bita'], false),
  ('scas@forgottenfelines.com', 'email',
   'FFSC/SCAS org email - DATA_GAP_009',
   0.99, true, 5, ARRAY['Various staff'], false)
ON CONFLICT (identifier_norm, identifier_type) DO UPDATE SET
  reason = EXCLUDED.reason,
  require_name_similarity = EXCLUDED.require_name_similarity,
  last_evaluated_at = NOW();

SELECT 'Soft blacklist entries added:' as info, COUNT(*) as count
FROM trapper.data_engine_soft_blacklist
WHERE identifier_norm LIKE '%forgottenfelines%';

-- ============================================================================
-- Phase 2: Update should_be_person() Function
-- ============================================================================

\echo ''
\echo 'Phase 2: Updating should_be_person() to check email patterns...'

CREATE OR REPLACE FUNCTION trapper.should_be_person(
  p_first_name text,
  p_last_name text,
  p_email text,
  p_phone text
) RETURNS boolean
LANGUAGE plpgsql
STABLE
AS $function$
DECLARE
  v_display_name TEXT;
  v_classification TEXT;
  v_email_norm TEXT;
BEGIN
  -- Normalize email
  v_email_norm := LOWER(TRIM(COALESCE(p_email, '')));

  -- ==========================================================================
  -- MIG_915: NEW - Reject organizational emails at the gate
  -- This closes the bypass where ClinicHQ processing skipped Data Engine checks
  -- ==========================================================================

  -- Check for FFSC organizational domain
  IF v_email_norm LIKE '%@forgottenfelines.com'
     OR v_email_norm LIKE '%@forgottenfelines.org'
  THEN
    RETURN FALSE;  -- Route to clinic_owner_accounts (pseudo-profile)
  END IF;

  -- Check for generic organizational email prefixes
  IF v_email_norm LIKE 'info@%'
     OR v_email_norm LIKE 'office@%'
     OR v_email_norm LIKE 'contact@%'
     OR v_email_norm LIKE 'admin@%'
     OR v_email_norm LIKE 'help@%'
     OR v_email_norm LIKE 'support@%'
  THEN
    RETURN FALSE;  -- Generic org emails should not create people
  END IF;

  -- Check soft blacklist for high-threshold (org) emails
  -- require_name_similarity >= 0.9 means it's effectively an org email block
  IF v_email_norm != '' AND EXISTS (
    SELECT 1 FROM trapper.data_engine_soft_blacklist
    WHERE identifier_norm = v_email_norm
      AND identifier_type = 'email'
      AND require_name_similarity >= 0.9
  ) THEN
    RETURN FALSE;  -- Soft-blacklisted org email
  END IF;

  -- ==========================================================================
  -- Original logic: Must have contact info
  -- ==========================================================================

  IF (p_email IS NULL OR TRIM(p_email) = '')
     AND (p_phone IS NULL OR TRIM(p_phone) = '')
  THEN
    RETURN FALSE;
  END IF;

  -- Must have at least first name
  IF p_first_name IS NULL OR TRIM(p_first_name) = '' THEN
    RETURN FALSE;
  END IF;

  -- Build display name and classify
  v_display_name := TRIM(COALESCE(p_first_name, '') || ' ' || COALESCE(p_last_name, ''));
  v_classification := trapper.classify_owner_name(v_display_name);

  -- Only create person if classified as likely_person
  RETURN v_classification = 'likely_person';
END;
$function$;

COMMENT ON FUNCTION trapper.should_be_person IS
'MIG_915: Added organizational email rejection at the routing gate.
Closes bypass where ClinicHQ processing skipped Data Engine email checks.
INV-17: Organizational emails must not create person records.

Checks added:
1. @forgottenfelines.com/org domains → reject
2. Generic org prefixes (info@, office@, contact@) → reject
3. Soft-blacklisted emails with require_name_similarity >= 0.9 → reject

Returns FALSE to route record to clinic_owner_accounts instead of sot_people.';

-- ============================================================================
-- Phase 3: Verify the fix
-- ============================================================================

\echo ''
\echo 'Phase 3: Verifying the fix...'

-- Test that org emails are rejected
SELECT 'Testing should_be_person():' as info;
SELECT
  'info@forgottenfelines.com' as email,
  trapper.should_be_person('Test', 'Person', 'info@forgottenfelines.com', NULL) as should_be_person,
  'Expected: FALSE' as expected;

SELECT
  'sandra@forgottenfelines.com' as email,
  trapper.should_be_person('Sandra', 'Nicander', 'sandra@forgottenfelines.com', NULL) as should_be_person,
  'Expected: FALSE' as expected;

SELECT
  'info@someorg.com' as email,
  trapper.should_be_person('John', 'Doe', 'info@someorg.com', NULL) as should_be_person,
  'Expected: FALSE (generic org prefix)' as expected;

SELECT
  'john.doe@gmail.com' as email,
  trapper.should_be_person('John', 'Doe', 'john.doe@gmail.com', NULL) as should_be_person,
  'Expected: TRUE (normal email)' as expected;

-- ============================================================================
-- Summary
-- ============================================================================

\echo ''
\echo '=============================================='
\echo 'MIG_915 Complete!'
\echo '=============================================='
\echo ''
\echo 'Changes made:'
\echo '  1. Added 10 FFSC organizational emails to soft blacklist'
\echo '  2. Updated should_be_person() to check email patterns:'
\echo '     - Rejects @forgottenfelines.com/org domains'
\echo '     - Rejects generic org prefixes (info@, office@, contact@)'
\echo '     - Rejects soft-blacklisted emails with high threshold'
\echo ''
\echo 'New Invariants:'
\echo '  INV-17: Organizational emails must not create person records'
\echo ''
\echo 'DATA_GAP_009: FFSC Organizational Email Bypass - FIXED'
\echo ''
\echo 'Next: Run MIG_916 to clean up erroneous Sandra relationships'
\echo ''
