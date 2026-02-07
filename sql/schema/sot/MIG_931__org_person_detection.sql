-- ============================================================================
-- MIG_931: Organization/Address Name Detection (DATA_GAP_011, DATA_GAP_018)
-- ============================================================================
-- Problem: 329 person records have organization-like or address-like names
--          with cats incorrectly linked to them.
--
-- Examples:
--   - "890 Rockwell Rd." - 51 cats (address as person)
--   - "Pub Republic Luv Pilates Parking Area" - 39 cats (location)
--   - "L & W Drywall Supply" - 6 duplicates (business)
--
-- Solution:
--   1. Enhance should_be_person() to catch more patterns
--   2. Create review view for staff to resolve manually
--   3. Flag records in data engine review queue
-- ============================================================================

\echo '=== MIG_931: Organization/Address Name Detection ==='
\echo ''

-- ============================================================================
-- Phase 1: Create helper function for address/org pattern detection
-- ============================================================================

\echo 'Phase 1: Creating organization/address pattern detector...'

CREATE OR REPLACE FUNCTION trapper.is_organization_or_address_name(p_display_name TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
IMMUTABLE
AS $function$
DECLARE
  v_name TEXT;
BEGIN
  v_name := TRIM(COALESCE(p_display_name, ''));

  -- Empty check
  IF v_name = '' THEN
    RETURN FALSE;
  END IF;

  -- ==========================================================================
  -- Address patterns (likely a place, not a person)
  -- ==========================================================================

  -- Starts with number + space (address like "890 Rockwell Rd")
  IF v_name ~ '^\d+ ' THEN
    RETURN TRUE;
  END IF;

  -- Contains street type suffixes
  IF v_name ~* '\s(rd\.?|road|st\.?|street|ave\.?|avenue|blvd\.?|boulevard|dr\.?|drive|ln\.?|lane|way|ct\.?|court|pl\.?|place|cir\.?|circle)\s*$' THEN
    RETURN TRUE;
  END IF;

  -- Contains street type in middle (like "890 Rockwell Rd. Unit 5")
  IF v_name ~* '\s(rd\.?|road|st\.?|street|ave\.?|avenue|blvd\.?|boulevard)\s' THEN
    RETURN TRUE;
  END IF;

  -- ==========================================================================
  -- Location/Place patterns
  -- ==========================================================================

  -- Parking, plaza, area, center keywords
  IF v_name ~* '(parking|plaza|area|center|centre|lot|complex|facility|building|terminal)' THEN
    RETURN TRUE;
  END IF;

  -- "The ..." pattern (like "The Villages", "The Meadows")
  IF v_name ~* '^the\s' AND v_name !~* '^the\s(great|good|real|original)\s' THEN
    -- Allow "The Great John" but catch "The Villages"
    IF v_name ~* '\s(village|meadow|park|garden|estate|ranch|farm|lodge|inn|resort|place|manor|court|terrace)s?\s*$' THEN
      RETURN TRUE;
    END IF;
  END IF;

  -- ==========================================================================
  -- Business/Organization patterns
  -- ==========================================================================

  -- Corporate suffixes
  IF v_name ~* '\s(inc\.?|llc\.?|corp\.?|corporation|company|co\.?|ltd\.?|limited|enterprise|enterprises|group|partners|associates|services|service|supply|supplies|solutions|systems|industries|industry)\.?\s*$' THEN
    RETURN TRUE;
  END IF;

  -- Rescue/Shelter organizations
  IF v_name ~* '(rescue|shelter|humane|spca|animal\s+(control|services)|foster\s+program|sanctuary)' THEN
    RETURN TRUE;
  END IF;

  -- "... of ..." pattern often indicates organization
  IF v_name ~* '(friends|society|association|foundation|alliance|coalition)\s+of\s+' THEN
    RETURN TRUE;
  END IF;

  -- Transit/Government
  IF v_name ~* '(transit|transportation|county|city\s+of|state\s+of|department|district)' THEN
    RETURN TRUE;
  END IF;

  -- All caps name that's more than 2 words (usually an org, not a person)
  IF v_name = UPPER(v_name) AND v_name ~ '\s.*\s' AND LENGTH(v_name) > 15 THEN
    -- Three or more words, all caps, longer than 15 chars - likely an org
    RETURN TRUE;
  END IF;

  RETURN FALSE;
END;
$function$;

COMMENT ON FUNCTION trapper.is_organization_or_address_name IS
'Detects if a display_name is likely an organization or address rather than a person.
Used to flag records for review and prevent future bad entries.
Part of DATA_GAP_011/018 fix (MIG_931).';

-- ============================================================================
-- Phase 2: Create review view for org/address person records
-- ============================================================================

\echo ''
\echo 'Phase 2: Creating organization/address person review view...'

CREATE OR REPLACE VIEW trapper.v_org_person_review AS
SELECT
  p.person_id,
  p.display_name,
  p.created_at,
  p.data_source,
  trapper.is_organization_or_address_name(p.display_name) as detected_as_org,
  COUNT(DISTINCT pcr.cat_id) as cat_count,
  COUNT(DISTINCT a.appointment_id) as appointment_count,
  array_agg(DISTINCT c.display_name ORDER BY c.display_name) FILTER (WHERE c.display_name IS NOT NULL) as cat_names,
  array_agg(DISTINCT pi.id_value_norm) FILTER (WHERE pi.id_value_norm IS NOT NULL) as identifiers,
  CASE
    WHEN p.display_name ~ '^\d+ ' THEN 'address_start_with_number'
    WHEN p.display_name ~* '\s(rd\.?|road|st\.?|street|ave\.?|avenue|blvd\.?)\s*$' THEN 'address_street_suffix'
    WHEN p.display_name ~* '(parking|plaza|area|center)' THEN 'location_keyword'
    WHEN p.display_name ~* '(inc\.?|llc\.?|corp\.?|company|supply)' THEN 'business_suffix'
    WHEN p.display_name ~* '(rescue|shelter|humane)' THEN 'rescue_org'
    ELSE 'other_pattern'
  END as detection_reason
FROM trapper.sot_people p
LEFT JOIN trapper.person_cat_relationships pcr ON pcr.person_id = p.person_id
LEFT JOIN trapper.sot_cats c ON c.cat_id = pcr.cat_id AND c.merged_into_cat_id IS NULL
LEFT JOIN trapper.sot_appointments a ON a.person_id = p.person_id
LEFT JOIN trapper.person_identifiers pi ON pi.person_id = p.person_id
WHERE p.merged_into_person_id IS NULL
  AND trapper.is_organization_or_address_name(p.display_name)
GROUP BY p.person_id, p.display_name, p.created_at, p.data_source
ORDER BY cat_count DESC, appointment_count DESC;

COMMENT ON VIEW trapper.v_org_person_review IS
'Person records detected as organizations or addresses that need staff review.
Part of DATA_GAP_011/018 fix (MIG_931).

Columns:
- detected_as_org: TRUE if is_organization_or_address_name() matched
- cat_count: Number of cats linked to this person
- appointment_count: Number of appointments
- detection_reason: Why this was flagged

Staff should review each record and:
1. Convert to known_organization if legitimate org
2. Merge cats to actual owner if data entry error
3. Delete if truly invalid';

-- ============================================================================
-- Phase 3: Update should_be_person() to use new detector
-- ============================================================================

\echo ''
\echo 'Phase 3: Updating should_be_person() to use organization detector...'

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
  -- MIG_915: Reject organizational emails at the gate
  -- ==========================================================================

  -- Check for FFSC organizational domain
  IF v_email_norm LIKE '%@forgottenfelines.com'
     OR v_email_norm LIKE '%@forgottenfelines.org'
  THEN
    RETURN FALSE;
  END IF;

  -- Check for generic organizational email prefixes
  IF v_email_norm LIKE 'info@%'
     OR v_email_norm LIKE 'office@%'
     OR v_email_norm LIKE 'contact@%'
     OR v_email_norm LIKE 'admin@%'
     OR v_email_norm LIKE 'help@%'
     OR v_email_norm LIKE 'support@%'
  THEN
    RETURN FALSE;
  END IF;

  -- Check soft blacklist for high-threshold (org) emails
  IF v_email_norm != '' AND EXISTS (
    SELECT 1 FROM trapper.data_engine_soft_blacklist
    WHERE identifier_norm = v_email_norm
      AND identifier_type = 'email'
      AND require_name_similarity >= 0.9
  ) THEN
    RETURN FALSE;
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

  -- Build display name
  v_display_name := TRIM(COALESCE(p_first_name, '') || ' ' || COALESCE(p_last_name, ''));

  -- ==========================================================================
  -- MIG_931: NEW - Check for organization/address patterns
  -- ==========================================================================

  IF trapper.is_organization_or_address_name(v_display_name) THEN
    RETURN FALSE;  -- Route to clinic_owner_accounts or known_organizations
  END IF;

  -- Use existing classify_owner_name for final check
  v_classification := trapper.classify_owner_name(v_display_name);

  -- Only create person if classified as likely_person
  RETURN v_classification = 'likely_person';
END;
$function$;

COMMENT ON FUNCTION trapper.should_be_person IS
'MIG_915+931: Validates if owner info should create a person record.

Rejects:
1. @forgottenfelines.com/org domains (MIG_915)
2. Generic org prefixes (info@, office@, contact@) (MIG_915)
3. Soft-blacklisted emails with high threshold (MIG_915)
4. Organization/address name patterns (MIG_931)
5. Names classified as non-person by classify_owner_name()

Returns FALSE to route record to clinic_owner_accounts instead of sot_people.';

-- ============================================================================
-- Phase 4: Count affected records
-- ============================================================================

\echo ''
\echo 'Phase 4: Counting org/address person records...'

SELECT 'Total org/address person records:' as info,
       COUNT(*) as count
FROM trapper.v_org_person_review;

SELECT 'Records by detection reason:' as header;
SELECT detection_reason, COUNT(*) as count
FROM trapper.v_org_person_review
GROUP BY detection_reason
ORDER BY count DESC;

SELECT 'Top 10 by cat count:' as header;
SELECT person_id, display_name, cat_count, detection_reason
FROM trapper.v_org_person_review
ORDER BY cat_count DESC
LIMIT 10;

-- ============================================================================
-- Summary
-- ============================================================================

\echo ''
\echo '=============================================='
\echo 'MIG_931 Complete!'
\echo '=============================================='
\echo ''
\echo 'DATA_GAP_011/018: Organization Names as People - DETECTION ADDED'
\echo ''
\echo 'Changes made:'
\echo '  1. Created is_organization_or_address_name() detector function'
\echo '  2. Created v_org_person_review view for staff review'
\echo '  3. Updated should_be_person() to reject org/address patterns'
\echo ''
\echo 'Staff action required:'
\echo '  Review records in v_org_person_review and resolve each:'
\echo '  - Convert to known_organization if legitimate org'
\echo '  - Merge cats to actual owner if data entry error'
\echo '  - Delete if truly invalid record'
\echo ''
