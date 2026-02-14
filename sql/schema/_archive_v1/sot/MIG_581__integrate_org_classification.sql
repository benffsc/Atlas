\echo '=== MIG_581: Integrate Organization Detection with Classification Engine ==='
\echo ''
\echo 'Updates classify_owner_name() to use is_organization_name() for consistent'
\echo 'detection across the system. Also fixes existing misclassified records.'
\echo ''

-- ============================================================================
-- PART 1: Update classify_owner_name() to use is_organization_name()
-- ============================================================================

\echo 'Updating classify_owner_name() to integrate with is_organization_name()...'

CREATE OR REPLACE FUNCTION trapper.classify_owner_name(p_name TEXT)
RETURNS TEXT AS $$
DECLARE
  cleaned TEXT;
BEGIN
  IF p_name IS NULL OR trim(p_name) = '' THEN
    RETURN 'unknown';
  END IF;

  -- Strip FFSC/SCAS suffix first
  cleaned := regexp_replace(trim(p_name), '\s+(ffsc|scas)$', '', 'i');

  -- 1. Check for exact known org matches (IS the org, not just contains suffix)
  IF cleaned ~* '^(ffsc|forgotten felines)' OR cleaned ~* '^(scas|sonoma county animal)' THEN
    RETURN 'known_org';
  END IF;

  -- 2. Check for garbage/address patterns (highest priority)
  IF trapper.is_garbage_name(cleaned) THEN
    RETURN 'address';
  END IF;

  -- 3. Additional address patterns
  IF cleaned ~* '^\d+\s+' THEN
    RETURN 'address';
  END IF;

  IF cleaned ~* '\b(road|lane|ave|avenue|street|st|blvd|boulevard|dr|drive|way|rd|ct|court|ln|pl|place)\b' THEN
    RETURN 'address';
  END IF;

  IF cleaned ~* '\b(block of)\b' THEN
    RETURN 'address';
  END IF;

  -- 4. Check for apartment complex patterns (should be places, not orgs)
  IF cleaned ~* '\b(apartments?|village|terrace|manor|gardens?|heights|towers?|plaza|residences?)\b' THEN
    RETURN 'apartment_complex';
  END IF;

  IF cleaned ~* '\b(senior|living|housing)\s+(center|community|complex)\b' THEN
    RETURN 'apartment_complex';
  END IF;

  IF cleaned ~* '\b(mobile home|trailer park|rv park)\b' THEN
    RETURN 'apartment_complex';
  END IF;

  -- 5. **INTEGRATED** - Use is_organization_name() for comprehensive org detection
  IF trapper.is_organization_name(cleaned) THEN
    RETURN 'organization';
  END IF;

  -- 6. Legacy org patterns (keep as fallback for edge cases)
  IF cleaned ~* '\b(school|middle school|high school|elementary|academy)\b' THEN
    RETURN 'organization';
  END IF;

  IF cleaned ~* '\b(church|hospital|clinic|shelter|rescue)\b' THEN
    RETURN 'organization';
  END IF;

  IF cleaned ~* '\b(corp|inc|llc|company|ltd)\b' THEN
    RETURN 'organization';
  END IF;

  IF cleaned ~* '\b(park|rec|recreation|center|centre)\b' THEN
    RETURN 'organization';
  END IF;

  -- 7. Check for typical person name pattern: "FirstName LastName"
  IF cleaned ~* '^[A-Z][a-z]+\s+[A-Z][a-z]+$' THEN
    RETURN 'likely_person';
  END IF;

  -- 8. Check for first/last name with middle initial: "John A Smith"
  IF cleaned ~* '^[A-Z][a-z]+\s+[A-Z]\.?\s+[A-Z][a-z]+$' THEN
    RETURN 'likely_person';
  END IF;

  -- Default: unknown - needs AI classification
  RETURN 'unknown';
END;
$$ LANGUAGE plpgsql STABLE;  -- Changed to STABLE since it calls other functions

COMMENT ON FUNCTION trapper.classify_owner_name IS
'Classifies a ClinicHQ owner name as likely_person, address, apartment_complex, organization, known_org, or unknown.
Now integrates with is_organization_name() for comprehensive organization detection.
Strips FFSC/SCAS suffix before classification. Used to route to sot_people vs clinic_owner_accounts.';

-- ============================================================================
-- PART 2: Fix existing misclassified clinic_owner_accounts
-- ============================================================================

\echo 'Fixing misclassified clinic_owner_accounts records...'

-- Update accounts that should be classified as 'organization'
UPDATE trapper.clinic_owner_accounts
SET
  account_type = 'organization',
  updated_at = NOW()
WHERE account_type != 'organization'
  AND trapper.is_organization_name(display_name);

-- Update accounts that should be classified as 'address'
UPDATE trapper.clinic_owner_accounts
SET
  account_type = 'address',
  updated_at = NOW()
WHERE account_type = 'unknown'
  AND (display_name ~ '^\d+\s+' OR trapper.is_garbage_name(display_name));

-- ============================================================================
-- PART 3: Link clinic_owner_accounts to known_organizations
-- ============================================================================

\echo 'Linking clinic_owner_accounts to known_organizations...'

-- Link accounts to known_organizations where patterns match
UPDATE trapper.clinic_owner_accounts coa
SET
  linked_org_id = ko.org_id,
  updated_at = NOW()
FROM trapper.known_organizations ko
WHERE coa.linked_org_id IS NULL
  AND coa.account_type = 'organization'
  AND (
    coa.display_name ILIKE ko.org_name_pattern
    OR coa.canonical_name ILIKE ko.org_name_pattern
  );

-- Also link to place if known_organization has a linked_place_id
UPDATE trapper.clinic_owner_accounts coa
SET
  linked_place_id = ko.linked_place_id,
  updated_at = NOW()
FROM trapper.known_organizations ko
WHERE coa.linked_org_id = ko.org_id
  AND coa.linked_place_id IS NULL
  AND ko.linked_place_id IS NOT NULL;

-- ============================================================================
-- PART 4: Verification
-- ============================================================================

\echo ''
\echo '=== Verification ==='

\echo 'Testing updated classify_owner_name():'
SELECT
  name,
  trapper.classify_owner_name(name) as classification,
  trapper.is_organization_name(name) as is_org_detected
FROM (VALUES
  ('Coast Guard Station'),
  ('Speedy Creek Winery'),
  ('Pub Republic Luv Pilates Parking Area'),
  ('Marin Humane'),
  ('890 Rockwell Rd.'),
  ('Santa Rosa Garden Apartments'),
  ('John Smith')
) AS t(name);

\echo ''
\echo 'Clinic owner accounts by type:'
SELECT account_type, COUNT(*)
FROM trapper.clinic_owner_accounts
GROUP BY account_type
ORDER BY COUNT(*) DESC;

\echo ''
\echo 'Accounts linked to known_organizations:'
SELECT
  coa.display_name,
  coa.account_type,
  ko.org_name as linked_org,
  coa.linked_place_id IS NOT NULL as has_place
FROM trapper.clinic_owner_accounts coa
JOIN trapper.known_organizations ko ON ko.org_id = coa.linked_org_id
LIMIT 10;

\echo ''
\echo '=== MIG_581 Complete ==='
\echo ''
\echo 'classify_owner_name() now integrates with is_organization_name() for'
\echo 'consistent organization detection across the entire system.'
\echo ''
