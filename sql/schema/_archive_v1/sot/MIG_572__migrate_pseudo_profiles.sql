\echo ''
\echo '=============================================='
\echo 'MIG_572: Migrate Pseudo-Profiles'
\echo '=============================================='
\echo ''
\echo 'Migrates existing pseudo-profiles from sot_people to clinic_owner_accounts.'
\echo 'This includes addresses, organizations, and apartments used as owner names.'
\echo ''

-- ============================================================================
-- STEP 1: Unmerge records incorrectly merged into FFSC/SCAS
-- ============================================================================

\echo 'Step 1: Unmerging records incorrectly merged into FFSC/SCAS...'

-- First, find the FFSC and SCAS person records
WITH known_org_persons AS (
  SELECT person_id, display_name
  FROM trapper.sot_people
  WHERE merged_into_person_id IS NULL
    AND (
      display_name ILIKE 'forgotten felines%'
      OR display_name ILIKE 'sonoma county animal%'
      OR display_name = 'FFSC'
      OR display_name = 'SCAS'
    )
)
UPDATE trapper.sot_people p
SET merged_into_person_id = NULL,
    merged_at = NULL,
    merge_reason = 'MIG_572: Unmerged - was incorrectly merged into ' || kop.display_name
WHERE p.merged_into_person_id IN (SELECT person_id FROM known_org_persons)
  AND (p.display_name ILIKE '% ffsc' OR p.display_name ILIKE '% scas')
  AND p.display_name NOT ILIKE 'forgotten felines%'
  AND p.display_name NOT ILIKE 'sonoma county animal%';

\echo '  Unmerged records that were incorrectly merged into FFSC/SCAS'

-- ============================================================================
-- STEP 2: Identify pseudo-profiles to migrate
-- ============================================================================

\echo ''
\echo 'Step 2: Identifying pseudo-profiles to migrate...'

-- Create temp table of records to migrate
CREATE TEMP TABLE temp_pseudo_profiles AS
SELECT
  p.person_id,
  p.display_name,
  trapper.classify_owner_name(p.display_name) as classification,
  trapper.extract_brought_by(p.display_name) as brought_by,
  trapper.strip_brought_by_suffix(p.display_name) as stripped_name,
  p.data_source,
  p.created_at,
  -- Get any appointments linked to this person
  (SELECT COUNT(*) FROM trapper.sot_appointments a WHERE a.person_id = p.person_id) as appointment_count
FROM trapper.sot_people p
WHERE p.merged_into_person_id IS NULL
  AND p.data_source = 'clinichq'
  -- No email or phone (not a real person with contact info)
  AND NOT EXISTS (
    SELECT 1 FROM trapper.person_identifiers pi
    WHERE pi.person_id = p.person_id
  )
  -- Matches pseudo-profile patterns
  AND trapper.classify_owner_name(p.display_name) IN (
    'address', 'apartment_complex', 'organization', 'known_org', 'unknown'
  )
  AND trapper.classify_owner_name(p.display_name) != 'likely_person';

\echo '  Found records to migrate:'
SELECT classification, COUNT(*) FROM temp_pseudo_profiles GROUP BY classification ORDER BY COUNT(*) DESC;

-- ============================================================================
-- STEP 3: Create clinic_owner_accounts records
-- ============================================================================

\echo ''
\echo 'Step 3: Creating clinic_owner_accounts records...'

INSERT INTO trapper.clinic_owner_accounts (
  display_name,
  account_type,
  brought_by,
  original_person_id,
  source_system,
  source_display_names,
  created_at
)
SELECT
  stripped_name,
  CASE classification
    WHEN 'address' THEN 'address'
    WHEN 'apartment_complex' THEN 'apartment_complex'
    WHEN 'organization' THEN 'organization'
    WHEN 'known_org' THEN 'organization'
    ELSE 'unknown'
  END,
  brought_by,
  person_id,
  'clinichq',
  ARRAY[display_name],
  created_at
FROM temp_pseudo_profiles
-- Avoid duplicates
ON CONFLICT DO NOTHING;

\echo '  Created clinic_owner_accounts records'

-- ============================================================================
-- STEP 4: Update sot_appointments to link to new accounts
-- ============================================================================

\echo ''
\echo 'Step 4: Linking appointments to new accounts...'

-- Update appointments that reference the migrated person records
UPDATE trapper.sot_appointments a
SET owner_account_id = coa.account_id
FROM trapper.clinic_owner_accounts coa
WHERE coa.original_person_id = a.person_id
  AND a.owner_account_id IS NULL;

\echo '  Updated appointment references'

-- Count how many were updated
SELECT COUNT(*) as appointments_linked
FROM trapper.sot_appointments
WHERE owner_account_id IS NOT NULL;

-- ============================================================================
-- STEP 5: Mark original sot_people records as migrated
-- ============================================================================

\echo ''
\echo 'Step 5: Marking original records as migrated...'

-- Add a column to track migration (if not exists)
ALTER TABLE trapper.sot_people
ADD COLUMN IF NOT EXISTS migrated_to_clinic_accounts BOOLEAN DEFAULT false;

-- Mark the migrated records
UPDATE trapper.sot_people p
SET migrated_to_clinic_accounts = true,
    account_type = 'migrated_to_clinic_accounts',
    account_type_reason = 'MIG_572: Migrated to clinic_owner_accounts'
FROM trapper.clinic_owner_accounts coa
WHERE coa.original_person_id = p.person_id;

\echo '  Marked migrated records'

-- ============================================================================
-- STEP 6: Handle FFSC/SCAS suffix records that were processed incorrectly
-- ============================================================================

\echo ''
\echo 'Step 6: Processing FFSC/SCAS suffix records...'

-- These are records like "Comstock Middle School FFSC" that should be
-- their own entities, not linked to FFSC

INSERT INTO trapper.clinic_owner_accounts (
  display_name,
  account_type,
  brought_by,
  original_person_id,
  source_system,
  source_display_names
)
SELECT
  trapper.strip_brought_by_suffix(p.display_name),
  CASE trapper.classify_owner_name(trapper.strip_brought_by_suffix(p.display_name))
    WHEN 'address' THEN 'address'
    WHEN 'apartment_complex' THEN 'apartment_complex'
    WHEN 'organization' THEN 'organization'
    ELSE 'unknown'
  END,
  trapper.extract_brought_by(p.display_name),
  p.person_id,
  'clinichq',
  ARRAY[p.display_name]
FROM trapper.sot_people p
WHERE p.merged_into_person_id IS NULL
  AND p.data_source = 'clinichq'
  AND (p.display_name ILIKE '% ffsc' OR p.display_name ILIKE '% scas')
  AND p.display_name NOT ILIKE 'forgotten felines%'
  AND p.display_name NOT ILIKE 'sonoma county animal%'
  -- Not already migrated
  AND NOT EXISTS (
    SELECT 1 FROM trapper.clinic_owner_accounts coa
    WHERE coa.original_person_id = p.person_id
  )
ON CONFLICT DO NOTHING;

\echo '  Processed FFSC/SCAS suffix records'

-- Link their appointments too
UPDATE trapper.sot_appointments a
SET owner_account_id = coa.account_id
FROM trapper.clinic_owner_accounts coa
WHERE coa.original_person_id = a.person_id
  AND a.owner_account_id IS NULL;

-- ============================================================================
-- STEP 7: Handle apartment complexes
-- ============================================================================

\echo ''
\echo 'Step 7: Processing apartment complex records...'

-- Find apartment records that might have been missed
INSERT INTO trapper.clinic_owner_accounts (
  display_name,
  account_type,
  brought_by,
  original_person_id,
  source_system,
  source_display_names
)
SELECT DISTINCT
  trapper.strip_brought_by_suffix(p.display_name),
  'apartment_complex',
  trapper.extract_brought_by(p.display_name),
  p.person_id,
  'clinichq',
  ARRAY[p.display_name]
FROM trapper.sot_people p
WHERE p.merged_into_person_id IS NULL
  AND p.data_source = 'clinichq'
  AND (
    p.display_name ~* '\b(apartments?|village|terrace|manor|gardens?|heights|towers?|plaza)\b'
    OR p.display_name ~* '\b(senior|living|housing)\s+(center|community)\b'
  )
  -- Exclude person names that match patterns (e.g., "Maria Villa")
  AND p.display_name !~* '(villa|villalobos|villanueva|villasenor|villafuerte|avilla)'
  -- Not already migrated
  AND NOT EXISTS (
    SELECT 1 FROM trapper.clinic_owner_accounts coa
    WHERE coa.original_person_id = p.person_id
  )
ON CONFLICT DO NOTHING;

\echo '  Processed apartment complex records'

-- Mark these in sot_people too
UPDATE trapper.sot_people p
SET migrated_to_clinic_accounts = true,
    account_type = 'migrated_to_clinic_accounts',
    account_type_reason = 'MIG_572: Migrated to clinic_owner_accounts'
FROM trapper.clinic_owner_accounts coa
WHERE coa.original_person_id = p.person_id
  AND p.migrated_to_clinic_accounts IS NOT TRUE;

-- ============================================================================
-- STEP 8: Final cleanup and stats
-- ============================================================================

\echo ''
\echo 'Step 8: Migration summary...'

DROP TABLE IF EXISTS temp_pseudo_profiles;

\echo ''
\echo '=============================================='
\echo 'MIG_572 Complete!'
\echo '=============================================='
\echo ''
\echo 'Results:'
SELECT * FROM trapper.v_clinic_accounts_stats;

\echo ''
\echo 'Appointments linked:'
SELECT COUNT(*) as total_linked FROM trapper.sot_appointments WHERE owner_account_id IS NOT NULL;

\echo ''
\echo 'Records migrated from sot_people:'
SELECT COUNT(*) as migrated FROM trapper.sot_people WHERE migrated_to_clinic_accounts = true;

\echo ''
\echo 'Next: Run research_clinic_accounts.mjs to enrich with AI'
\echo ''
