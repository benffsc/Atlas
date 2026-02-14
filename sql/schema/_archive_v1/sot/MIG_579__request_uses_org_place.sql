\echo '=== MIG_579: Request Creation Uses Organization Place ==='
\echo ''
\echo 'Updates find_or_create_request() to auto-use org canonical place'
\echo 'when requester is an organization representative.'
\echo ''

-- ============================================================================
-- Update find_or_create_request to check for org place
-- ============================================================================

\echo 'Updating find_or_create_request function...'

CREATE OR REPLACE FUNCTION trapper.find_or_create_request(
  p_source_system TEXT,
  p_source_record_id TEXT,
  p_source_created_at TIMESTAMPTZ DEFAULT NULL,
  p_place_id UUID DEFAULT NULL,
  p_raw_address TEXT DEFAULT NULL,
  p_requester_person_id UUID DEFAULT NULL,
  p_requester_email TEXT DEFAULT NULL,
  p_requester_phone TEXT DEFAULT NULL,
  p_requester_name TEXT DEFAULT NULL,
  p_summary TEXT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL,
  p_estimated_cat_count INT DEFAULT NULL,
  p_status TEXT DEFAULT 'new',
  p_priority TEXT DEFAULT 'normal',
  p_has_kittens BOOLEAN DEFAULT FALSE,
  p_kitten_count INT DEFAULT NULL,
  p_kitten_age_weeks INT DEFAULT NULL,
  p_kitten_assessment_status TEXT DEFAULT NULL,
  p_kitten_assessment_outcome TEXT DEFAULT NULL,
  p_kitten_not_needed_reason TEXT DEFAULT NULL,
  p_cats_are_friendly BOOLEAN DEFAULT NULL,
  p_request_purpose TEXT DEFAULT 'tnr',
  p_internal_notes TEXT DEFAULT NULL,
  p_created_by TEXT DEFAULT NULL,
  p_copy_from_request_id UUID DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
  v_request_id UUID;
  v_resolved_place_id UUID;
  v_resolved_requester_id UUID;
  v_existing_request_id UUID;
  v_now TIMESTAMPTZ := COALESCE(p_source_created_at, NOW());
  v_first_name TEXT;
  v_last_name TEXT;
  v_comma_pos INT;
  v_source_request RECORD;
  v_org_place_id UUID;  -- NEW: For org place lookup
BEGIN
  -- Check for existing request with same source
  SELECT request_id INTO v_existing_request_id
  FROM trapper.sot_requests
  WHERE source_system = p_source_system
    AND source_record_id = p_source_record_id;

  IF v_existing_request_id IS NOT NULL THEN
    RETURN v_existing_request_id;
  END IF;

  -- If copying from another request, get its kitten fields as defaults
  IF p_copy_from_request_id IS NOT NULL THEN
    SELECT * INTO v_source_request
    FROM trapper.sot_requests
    WHERE request_id = p_copy_from_request_id;
  END IF;

  -- =========================================================================
  -- Resolve requester person_id FIRST (need this for org place lookup)
  -- =========================================================================
  v_resolved_requester_id := p_requester_person_id;

  -- If no person_id but contact info provided, create/find the person
  IF v_resolved_requester_id IS NULL AND (p_requester_email IS NOT NULL OR p_requester_phone IS NOT NULL OR p_requester_name IS NOT NULL) THEN
    -- Parse name (expected format: "Last, First" or just "Name")
    IF p_requester_name IS NOT NULL THEN
      v_comma_pos := POSITION(',' IN p_requester_name);
      IF v_comma_pos > 0 THEN
        -- "Last, First" format
        v_last_name := TRIM(SUBSTRING(p_requester_name FROM 1 FOR v_comma_pos - 1));
        v_first_name := TRIM(SUBSTRING(p_requester_name FROM v_comma_pos + 1));
      ELSE
        -- Single name - treat as first name
        v_first_name := TRIM(p_requester_name);
        v_last_name := NULL;
      END IF;
    END IF;

    v_resolved_requester_id := trapper.find_or_create_person(
      p_email := p_requester_email,
      p_phone := p_requester_phone,
      p_first_name := v_first_name,
      p_last_name := v_last_name,
      p_address := p_raw_address,
      p_source_system := p_source_system
    );
  END IF;

  -- =========================================================================
  -- Resolve place_id (now with org place check)
  -- =========================================================================
  v_resolved_place_id := p_place_id;

  -- If no place_id but raw_address provided, create/find the place
  IF v_resolved_place_id IS NULL AND p_raw_address IS NOT NULL AND p_raw_address != '' THEN
    v_resolved_place_id := trapper.find_or_create_place_deduped(
      p_formatted_address := p_raw_address,
      p_display_name := NULL,
      p_lat := NULL,
      p_lng := NULL,
      p_source_system := p_source_system
    );
  END IF;

  -- NEW: If STILL no place but we have a requester, check if they're an org rep
  IF v_resolved_place_id IS NULL AND v_resolved_requester_id IS NOT NULL THEN
    -- Check if requester is a representative for any organization
    SELECT ko.linked_place_id INTO v_org_place_id
    FROM trapper.known_organizations ko
    JOIN trapper.organization_person_mappings opm
      ON opm.representative_person_id = v_resolved_requester_id
    WHERE ko.linked_place_id IS NOT NULL
      AND ko.org_name ILIKE REPLACE(opm.org_pattern, '%', '')  -- Match org
    LIMIT 1;

    IF v_org_place_id IS NOT NULL THEN
      v_resolved_place_id := v_org_place_id;
    END IF;
  END IF;

  -- Create the request
  INSERT INTO trapper.sot_requests (
    request_id,
    source_system,
    source_record_id,
    source_created_at,
    place_id,
    requester_person_id,
    summary,
    notes,
    internal_notes,
    estimated_cat_count,
    has_kittens,
    kitten_count,
    kitten_age_weeks,
    kitten_assessment_status,
    kitten_assessment_outcome,
    kitten_not_needed_reason,
    cats_are_friendly,
    status,
    priority,
    request_purpose,
    data_source,
    created_by,
    created_at,
    updated_at
  ) VALUES (
    gen_random_uuid(),
    p_source_system,
    p_source_record_id,
    v_now,
    v_resolved_place_id,
    v_resolved_requester_id,
    p_summary,
    p_notes,
    p_internal_notes,
    p_estimated_cat_count,
    COALESCE(p_has_kittens, v_source_request.has_kittens, FALSE),
    COALESCE(p_kitten_count, v_source_request.kitten_count),
    COALESCE(p_kitten_age_weeks, v_source_request.kitten_age_weeks),
    COALESCE(p_kitten_assessment_status, v_source_request.kitten_assessment_status),
    COALESCE(p_kitten_assessment_outcome, v_source_request.kitten_assessment_outcome),
    COALESCE(p_kitten_not_needed_reason, v_source_request.kitten_not_needed_reason),
    p_cats_are_friendly,
    COALESCE(NULLIF(p_status, '')::trapper.request_status, 'new'),
    COALESCE(NULLIF(p_priority, '')::trapper.request_priority, 'normal'),
    COALESCE(NULLIF(p_request_purpose, '')::trapper.request_purpose, 'tnr'),
    'app',
    p_created_by,
    v_now,
    v_now
  )
  RETURNING request_id INTO v_request_id;

  RETURN v_request_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.find_or_create_request IS
'Central request creation function with org place auto-linking.

When a requester is an organization representative and no place is provided,
automatically uses the organization''s canonical place.

Example: A request for "Natasha Reed" (Coast Guard rep) with no address
will automatically link to the Coast Guard Station place.';

-- ============================================================================
-- Verification
-- ============================================================================

\echo ''
\echo '=== Verification ==='

-- Test that Natasha Reed (Coast Guard rep) would get the org place
SELECT
  'Natasha Reed org check' as test,
  ko.org_name,
  ko.linked_place_id IS NOT NULL as has_place,
  opm.representative_person_id IS NOT NULL as has_rep
FROM trapper.known_organizations ko
JOIN trapper.organization_person_mappings opm
  ON ko.org_name ILIKE REPLACE(opm.org_pattern, '%', '')
WHERE ko.org_name ILIKE '%Coast Guard%'
LIMIT 1;

\echo ''
\echo '=== MIG_579 Complete ==='
\echo ''
\echo 'find_or_create_request() now auto-links to org place when:'
\echo '  1. No place_id provided'
\echo '  2. No raw_address provided'
\echo '  3. Requester is an organization representative'
\echo ''
