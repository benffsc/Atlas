\echo ''
\echo '=================================================='
\echo 'MIG_575: Partner Org Pattern Migration'
\echo '=================================================='
\echo ''
\echo 'Migrates FFSC/SCAS prefixed/suffixed records from sot_people'
\echo 'to clinic_owner_accounts with proper brought_by tracking.'
\echo ''

-- ============================================================
-- STEP 1: Show current state
-- ============================================================
\echo 'Current org patterns in sot_people:'

WITH categorized AS (
  SELECT
    p.person_id,
    p.display_name,
    CASE
      -- Org prefix + person name pattern (e.g., "Scas Mark Belew")
      WHEN p.display_name ~* '^(scas|ffsc)\s+[A-Z][a-z]+\s+[A-Z][a-z]+$'
        THEN 'org_person'
      -- Org prefix + location (e.g., "Ffsc Big John's Market")
      WHEN p.display_name ~* '^(scas|ffsc)\s+'
        THEN 'org_location_prefix'
      -- Location + org suffix (e.g., "286 Skillman SCAS")
      WHEN p.display_name ~* '\s+(scas|ffsc)$'
        THEN 'org_location_suffix'
      -- Just the org name
      WHEN p.display_name ~* '^(scas|ffsc|forgotten felines|sonoma county animal)'
        THEN 'org_only'
      ELSE 'other'
    END as pattern_type,
    CASE
      WHEN p.display_name ~* 'scas|sonoma county animal' THEN 'SCAS'
      WHEN p.display_name ~* 'ffsc|forgotten felines' THEN 'FFSC'
    END as org_short_name
  FROM trapper.sot_people p
  WHERE p.merged_into_person_id IS NULL
    AND (
      p.display_name ~* '^(scas|ffsc)\s+'
      OR p.display_name ~* '\s+(scas|ffsc)$'
      OR p.display_name ~* '^(forgotten felines|sonoma county animal)'
    )
)
SELECT pattern_type, org_short_name, COUNT(*) as count
FROM categorized
GROUP BY 1, 2
ORDER BY 1, 2;

-- ============================================================
-- STEP 2: Process "org_person" pattern (e.g., "Scas Mark Belew")
-- ============================================================
\echo ''
\echo 'Processing org_person patterns (converting to real people)...'

UPDATE trapper.sot_people
SET
  display_name = regexp_replace(display_name, '^(scas|ffsc)\s+', '', 'i'),
  account_type = 'person',
  account_type_reason = CASE
    WHEN display_name ~* '^scas' THEN 'SCAS contact - extracted from ClinicHQ'
    WHEN display_name ~* '^ffsc' THEN 'FFSC contact - extracted from ClinicHQ'
  END
WHERE display_name ~* '^(scas|ffsc)\s+[A-Z][a-z]+\s+[A-Z][a-z]+$'
  AND merged_into_person_id IS NULL;

\echo 'Updated org_person records'

-- ============================================================
-- STEP 3: Process "org_location_prefix/suffix" patterns
-- ============================================================
\echo ''
\echo 'Processing org_location patterns (migrating to clinic_owner_accounts)...'

INSERT INTO trapper.clinic_owner_accounts (
  display_name,
  account_type,
  brought_by,
  source_system,
  source_display_names,
  original_person_id,
  ai_research_notes
)
SELECT
  regexp_replace(
    regexp_replace(p.display_name, '^(scas|ffsc)\s+', '', 'i'),
    '\s+(scas|ffsc)$', '', 'i'
  ) as display_name,
  CASE
    WHEN regexp_replace(regexp_replace(p.display_name, '^(scas|ffsc)\s+', '', 'i'), '\s+(scas|ffsc)$', '', 'i') ~* '^\d+' THEN 'address'
    WHEN p.display_name ~* '\b(school|church|market|store|hospital|center|park|trail|winery|farm|dairy|restaurant|hotel|motel)\b' THEN 'organization'
    ELSE 'unknown'
  END as account_type,
  CASE
    WHEN p.display_name ~* 'scas' THEN 'SCAS'
    WHEN p.display_name ~* 'ffsc' THEN 'FFSC'
  END as brought_by,
  'clinichq',
  ARRAY[p.display_name],
  p.person_id,
  'Migrated from sot_people - org suffix indicates who brought the cat'
FROM trapper.sot_people p
WHERE (p.display_name ~* '^(scas|ffsc)\s+' OR p.display_name ~* '\s+(scas|ffsc)$')
  AND NOT p.display_name ~* '^(scas|ffsc)\s+[A-Z][a-z]+\s+[A-Z][a-z]+$'  -- Not person pattern
  AND p.merged_into_person_id IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM trapper.clinic_owner_accounts coa
    WHERE lower(coa.display_name) = lower(regexp_replace(
      regexp_replace(p.display_name, '^(scas|ffsc)\s+', '', 'i'),
      '\s+(scas|ffsc)$', '', 'i'
    ))
  )
ON CONFLICT DO NOTHING;

\echo 'Inserted org_location records into clinic_owner_accounts'

-- ============================================================
-- STEP 4: Link new accounts to places
-- ============================================================
\echo ''
\echo 'Linking new accounts to places...'

UPDATE trapper.clinic_owner_accounts coa
SET linked_place_id = (
  SELECT p.place_id
  FROM trapper.places p
  WHERE p.merged_into_place_id IS NULL
    AND (
      trapper.normalize_address(p.formatted_address) = trapper.normalize_address(coa.display_name)
      OR p.display_name ILIKE '%' || split_part(coa.display_name, ' ', 1) || '%'
    )
  LIMIT 1
)
WHERE coa.linked_place_id IS NULL
  AND coa.brought_by IS NOT NULL
  AND coa.original_person_id IS NOT NULL;

-- ============================================================
-- STEP 5: Update appointments to use new accounts
-- ============================================================
\echo ''
\echo 'Updating appointments to use new accounts...'

UPDATE trapper.sot_appointments a
SET owner_account_id = coa.account_id,
    person_id = NULL
FROM trapper.clinic_owner_accounts coa
WHERE coa.original_person_id = a.person_id
  AND coa.original_person_id IS NOT NULL
  AND a.owner_account_id IS NULL;

-- ============================================================
-- STEP 6: Set partner_org_id on all SCAS-related appointments
-- ============================================================
\echo ''
\echo 'Setting partner_org_id for SCAS appointments...'

UPDATE trapper.sot_appointments a
SET partner_org_id = '21236166-35e4-48b7-9b5f-8fec7e7a4e3f'::uuid
WHERE partner_org_id IS NULL
  AND (
    EXISTS (SELECT 1 FROM trapper.clinic_owner_accounts coa
            WHERE a.owner_account_id = coa.account_id AND coa.brought_by = 'SCAS')
    OR EXISTS (SELECT 1 FROM trapper.sot_people p
               WHERE a.person_id = p.person_id
               AND p.account_type_reason LIKE '%SCAS%')
  );

-- ============================================================
-- STEP 7: Mark migrated sot_people records
-- ============================================================
\echo ''
\echo 'Marking migrated sot_people records...'

UPDATE trapper.sot_people p
SET account_type = 'migrated_to_account',
    account_type_reason = 'Migrated to clinic_owner_accounts'
WHERE p.person_id IN (
  SELECT original_person_id FROM trapper.clinic_owner_accounts WHERE original_person_id IS NOT NULL
)
AND account_type IS DISTINCT FROM 'migrated_to_account';

-- ============================================================
-- SUMMARY
-- ============================================================
\echo ''
\echo '=================================================='
\echo 'MIG_575 Complete!'
\echo '=================================================='
\echo ''
\echo 'Summary:'

SELECT brought_by, COUNT(*) as accounts, COUNT(linked_place_id) as has_place
FROM trapper.clinic_owner_accounts
WHERE brought_by IS NOT NULL
GROUP BY brought_by
ORDER BY accounts DESC;

\echo ''
\echo 'Org contacts extracted:'

SELECT display_name, account_type_reason
FROM trapper.sot_people
WHERE account_type_reason LIKE '%contact%'
ORDER BY display_name;
