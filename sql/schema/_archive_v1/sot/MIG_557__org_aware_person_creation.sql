-- ============================================================================
-- MIG_557: Organization-Aware Person Creation
-- ============================================================================
-- Modifies person creation to check for known organizations first.
-- When creating a person with a name matching a known org, reuses the
-- canonical person record instead of creating duplicates.
-- ============================================================================

\echo '=== MIG_557: Organization-Aware Person Creation ==='

-- ============================================================================
-- Enhanced find_or_create_person that checks known orgs
-- ============================================================================

CREATE OR REPLACE FUNCTION trapper.find_or_create_person(
  p_email TEXT DEFAULT NULL,
  p_phone TEXT DEFAULT NULL,
  p_first_name TEXT DEFAULT NULL,
  p_last_name TEXT DEFAULT NULL,
  p_address TEXT DEFAULT NULL,
  p_source_system TEXT DEFAULT 'atlas_ui',
  p_source_id TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
AS $$
DECLARE
  v_person_id UUID;
  v_display_name TEXT;
  v_org_match RECORD;
BEGIN
  -- Build display name
  v_display_name := TRIM(COALESCE(p_first_name, '') || ' ' || COALESCE(p_last_name, ''));
  IF v_display_name = '' OR v_display_name = ' ' THEN
    v_display_name := NULL;
  END IF;

  -- ========================================================================
  -- STEP 1: Check if this is a known organization
  -- ========================================================================
  IF v_display_name IS NOT NULL THEN
    SELECT * INTO v_org_match
    FROM trapper.match_known_organization(v_display_name)
    WHERE confidence >= 0.75
    LIMIT 1;

    IF v_org_match IS NOT NULL THEN
      -- Get the canonical person for this org
      SELECT canonical_person_id INTO v_person_id
      FROM trapper.known_organizations
      WHERE org_id = v_org_match.org_id;

      IF v_person_id IS NOT NULL THEN
        -- Log that we matched to known org
        RAISE NOTICE 'Matched to known org "%" (confidence: %)', v_org_match.canonical_name, v_org_match.confidence;
        RETURN v_person_id;
      END IF;
    END IF;
  END IF;

  -- ========================================================================
  -- STEP 2: Standard identity resolution via unified function
  -- ========================================================================
  v_person_id := trapper.unified_find_or_create_person(
    p_email,
    p_phone,
    p_first_name,
    p_last_name,
    p_address,
    p_source_system,
    p_source_id
  );

  RETURN v_person_id;
END;
$$;

COMMENT ON FUNCTION trapper.find_or_create_person IS
'Organization-aware person find/create. Checks known organizations first to prevent duplicates for entities like "Sonoma County Animal Services".';

-- ============================================================================
-- View for monitoring org matching effectiveness
-- ============================================================================

CREATE OR REPLACE VIEW trapper.v_org_matching_candidates AS
SELECT
  p.person_id,
  p.display_name,
  p.source_system,
  p.created_at,
  ko.canonical_name AS potential_org_match,
  ko.short_name,
  (SELECT confidence FROM trapper.match_known_organization(p.display_name) LIMIT 1) AS match_confidence
FROM trapper.sot_people p
LEFT JOIN trapper.known_organizations ko ON TRUE
WHERE p.merged_into_person_id IS NULL
  AND p.person_type != 'organization'
  AND EXISTS (
    SELECT 1 FROM trapper.match_known_organization(p.display_name)
    WHERE confidence >= 0.60
  )
ORDER BY p.created_at DESC;

COMMENT ON VIEW trapper.v_org_matching_candidates IS
'Shows person records that might be organizations based on name matching. Useful for finding misclassified orgs.';

\echo ''
\echo '=== MIG_557 Complete ==='
\echo 'Updated find_or_create_person to check known organizations first'
\echo 'Created v_org_matching_candidates view for monitoring'
