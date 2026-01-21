\echo '=============================================='
\echo 'MIG_531: Fix find_or_create_request parameter names'
\echo '=============================================='

-- Fix the parameter names: p_latitude/p_longitude -> p_lat/p_lng
-- to match find_or_create_place_deduped signature

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
  p_cats_are_friendly BOOLEAN DEFAULT NULL,
  p_request_purpose TEXT DEFAULT 'tnr',
  p_internal_notes TEXT DEFAULT NULL,
  p_created_by TEXT DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
  v_request_id UUID;
  v_resolved_place_id UUID;
  v_resolved_requester_id UUID;
  v_existing_request_id UUID;
  v_now TIMESTAMPTZ := COALESCE(p_source_created_at, NOW());
BEGIN
  -- Check for existing request with same source
  SELECT request_id INTO v_existing_request_id
  FROM trapper.sot_requests
  WHERE source_system = p_source_system
    AND source_record_id = p_source_record_id;

  IF v_existing_request_id IS NOT NULL THEN
    RETURN v_existing_request_id;
  END IF;

  -- Resolve place_id
  v_resolved_place_id := p_place_id;

  -- If no place_id but raw_address provided, create/find the place
  IF v_resolved_place_id IS NULL AND p_raw_address IS NOT NULL AND p_raw_address != '' THEN
    v_resolved_place_id := trapper.find_or_create_place_deduped(
      p_formatted_address := p_raw_address,
      p_display_name := NULL,
      p_lat := NULL,  -- Will be geocoded later
      p_lng := NULL,
      p_source_system := p_source_system
    );
  END IF;

  -- Resolve requester person_id
  v_resolved_requester_id := p_requester_person_id;

  -- If no person_id but contact info provided, create/find the person
  IF v_resolved_requester_id IS NULL AND (p_requester_email IS NOT NULL OR p_requester_phone IS NOT NULL OR p_requester_name IS NOT NULL) THEN
    v_resolved_requester_id := trapper.find_or_create_person(
      p_email := p_requester_email,
      p_phone := p_requester_phone,
      p_name := p_requester_name,
      p_address := p_raw_address,
      p_source_system := p_source_system
    );
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
    estimated_cat_count,
    status,
    priority,
    has_kittens,
    cats_are_friendly,
    request_purpose,
    internal_notes,
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
    p_estimated_cat_count,
    p_status::trapper.request_status,
    p_priority::trapper.request_priority,
    p_has_kittens,
    p_cats_are_friendly,
    p_request_purpose::trapper.request_purpose,
    p_internal_notes,
    p_created_by,
    v_now,
    v_now
  )
  RETURNING request_id INTO v_request_id;

  RETURN v_request_id;
END;
$$ LANGUAGE plpgsql;

\echo 'MIG_531 Complete - Fixed parameter names in find_or_create_request'
