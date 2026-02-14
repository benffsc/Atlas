\echo ''
\echo '=============================================='
\echo 'MIG_537: Add kitten assessment fields to request functions'
\echo '=============================================='
\echo ''
\echo 'Updates find_or_create_request, handoff_request, and redirect_request'
\echo 'to accept and pass full kitten assessment fields.'
\echo ''

-- ============================================================================
-- PART 0: Add kitten_not_needed_reason column to sot_requests
-- ============================================================================

\echo 'Adding kitten_not_needed_reason column...'

ALTER TABLE trapper.sot_requests
ADD COLUMN IF NOT EXISTS kitten_not_needed_reason TEXT;

COMMENT ON COLUMN trapper.sot_requests.kitten_not_needed_reason IS
'Optional explanation when kitten_assessment_status is "not_needed" (e.g., "Kittens already 8+ weeks, TNR candidates")';

-- ============================================================================
-- PART 1: Update find_or_create_request to accept kitten fields
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
  p_copy_from_request_id UUID DEFAULT NULL  -- Optional: copy kitten fields from another request
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
'Central request creation function with full kitten assessment support.
Creates or finds an existing request, auto-creating places and people as needed.
New parameters for kitten assessment: p_kitten_count, p_kitten_age_weeks,
p_kitten_assessment_status, p_kitten_assessment_outcome, p_kitten_not_needed_reason.
Use p_copy_from_request_id to copy kitten fields from another request as defaults.';

-- ============================================================================
-- PART 2: Update handoff_request to accept and pass kitten fields
-- ============================================================================

\echo 'Updating handoff_request function...'

CREATE OR REPLACE FUNCTION trapper.handoff_request(
  p_original_request_id UUID,
  p_handoff_reason TEXT,
  p_new_address TEXT,
  p_new_requester_name TEXT,
  p_new_requester_phone TEXT DEFAULT NULL,
  p_new_requester_email TEXT DEFAULT NULL,
  p_summary TEXT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL,
  p_estimated_cat_count INT DEFAULT NULL,
  p_created_by TEXT DEFAULT 'handoff_workflow',
  p_new_requester_person_id UUID DEFAULT NULL,
  -- Kitten fields (new)
  p_has_kittens BOOLEAN DEFAULT NULL,
  p_kitten_count INT DEFAULT NULL,
  p_kitten_age_weeks INT DEFAULT NULL,
  p_kitten_assessment_status TEXT DEFAULT NULL,
  p_kitten_assessment_outcome TEXT DEFAULT NULL,
  p_kitten_not_needed_reason TEXT DEFAULT NULL
)
RETURNS TABLE(
  original_request_id UUID,
  new_request_id UUID,
  handoff_status TEXT
) AS $$
DECLARE
  v_new_request_id UUID;
  v_original RECORD;
  v_handoff_at TIMESTAMPTZ := NOW();
  v_original_address TEXT;
BEGIN
  -- Get original request details
  SELECT r.*, p.formatted_address AS place_address
  INTO v_original
  FROM trapper.sot_requests r
  LEFT JOIN trapper.places p ON p.place_id = r.place_id
  WHERE r.request_id = p_original_request_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Original request % not found', p_original_request_id;
  END IF;

  IF v_original.status IN ('redirected', 'handed_off', 'cancelled') THEN
    RAISE EXCEPTION 'Request % has already been closed (status: %)',
      p_original_request_id, v_original.status;
  END IF;

  v_original_address := COALESCE(v_original.place_address, 'unknown address');

  -- Create new request at new location with new requester
  v_new_request_id := trapper.find_or_create_request(
    p_source_system := 'atlas_ui',
    p_source_record_id := 'handoff_from_' || p_original_request_id::TEXT || '_' || EXTRACT(EPOCH FROM v_handoff_at)::TEXT,
    p_source_created_at := v_handoff_at,
    p_raw_address := p_new_address,
    p_requester_email := p_new_requester_email,
    p_requester_phone := p_new_requester_phone,
    p_requester_name := p_new_requester_name,
    p_requester_person_id := p_new_requester_person_id,
    p_summary := COALESCE(p_summary, 'Continuation: ' || COALESCE(v_original.summary, 'Colony care')),
    p_notes := COALESCE(p_notes, '') ||
      E'\n\n--- Handoff History ---' ||
      E'\nContinued from: ' || v_original_address ||
      E'\nHandoff reason: ' || p_handoff_reason ||
      E'\nOriginal request: ' || p_original_request_id::TEXT,
    p_estimated_cat_count := COALESCE(p_estimated_cat_count, v_original.estimated_cat_count),
    p_has_kittens := COALESCE(p_has_kittens, v_original.has_kittens),
    p_kitten_count := COALESCE(p_kitten_count, v_original.kitten_count),
    p_kitten_age_weeks := COALESCE(p_kitten_age_weeks, v_original.kitten_age_weeks),
    p_kitten_assessment_status := p_kitten_assessment_status,  -- Don't copy - requires re-assessment
    p_kitten_assessment_outcome := p_kitten_assessment_outcome,
    p_kitten_not_needed_reason := p_kitten_not_needed_reason,
    p_status := 'new',
    p_priority := v_original.priority::TEXT,
    p_created_by := p_created_by
  );

  -- Link new request back to original (use same columns as redirect)
  UPDATE trapper.sot_requests
  SET
    redirected_from_request_id = p_original_request_id,
    transfer_type = 'handoff'
  WHERE request_id = v_new_request_id;

  -- Close original as handed_off
  UPDATE trapper.sot_requests
  SET
    status = 'handed_off'::trapper.request_status,
    redirected_to_request_id = v_new_request_id,
    redirect_reason = p_handoff_reason,  -- Reuse column for handoff reason
    redirect_at = v_handoff_at,
    transfer_type = 'handoff',
    resolved_at = v_handoff_at,
    resolution_notes = 'Handed off to ' || p_new_requester_name || ' at ' || p_new_address ||
                       E'\nReason: ' || p_handoff_reason,
    updated_at = NOW()
  WHERE request_id = p_original_request_id;

  -- Audit log
  INSERT INTO trapper.entity_edits (
    entity_type, entity_id, edit_type, field_name,
    old_value, new_value, reason, edit_source, edited_by
  ) VALUES (
    'request', p_original_request_id, 'field_update', 'status',
    to_jsonb(v_original.status::TEXT), '"handed_off"',
    'Handed off to ' || p_new_requester_name || ': ' || p_handoff_reason,
    'api', p_created_by
  );

  RETURN QUERY SELECT p_original_request_id, v_new_request_id, 'success'::TEXT;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.handoff_request IS
'Hands off a request to a new caretaker at a new location with full kitten assessment.

New kitten parameters: p_has_kittens, p_kitten_count, p_kitten_age_weeks,
p_kitten_assessment_status, p_kitten_assessment_outcome, p_kitten_not_needed_reason.

Kitten count and age default to original request values. Assessment status/outcome
do NOT copy (requires re-assessment by new caretaker).';

-- ============================================================================
-- PART 3: Update redirect_request to accept and pass kitten fields
-- ============================================================================

\echo 'Updating redirect_request function...'

-- First check if redirect_request exists and update it
DO $$
BEGIN
  -- Drop and recreate with new signature
  DROP FUNCTION IF EXISTS trapper.redirect_request(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, INT, TEXT);
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

CREATE OR REPLACE FUNCTION trapper.redirect_request(
  p_original_request_id UUID,
  p_redirect_reason TEXT,
  p_new_address TEXT DEFAULT NULL,
  p_new_place_id UUID DEFAULT NULL,
  p_new_requester_name TEXT DEFAULT NULL,
  p_new_requester_phone TEXT DEFAULT NULL,
  p_new_requester_email TEXT DEFAULT NULL,
  p_summary TEXT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL,
  p_estimated_cat_count INT DEFAULT NULL,
  p_created_by TEXT DEFAULT 'redirect_workflow',
  -- Kitten fields (new)
  p_has_kittens BOOLEAN DEFAULT NULL,
  p_kitten_count INT DEFAULT NULL,
  p_kitten_age_weeks INT DEFAULT NULL,
  p_kitten_assessment_status TEXT DEFAULT NULL,
  p_kitten_assessment_outcome TEXT DEFAULT NULL,
  p_kitten_not_needed_reason TEXT DEFAULT NULL
)
RETURNS TABLE(
  original_request_id UUID,
  new_request_id UUID,
  redirect_status TEXT
) AS $$
DECLARE
  v_new_request_id UUID;
  v_original RECORD;
  v_redirect_at TIMESTAMPTZ := NOW();
  v_original_address TEXT;
BEGIN
  -- Get original request details
  SELECT r.*, p.formatted_address AS place_address,
         per.display_name AS requester_display_name
  INTO v_original
  FROM trapper.sot_requests r
  LEFT JOIN trapper.places p ON p.place_id = r.place_id
  LEFT JOIN trapper.sot_people per ON per.person_id = r.requester_person_id
  WHERE r.request_id = p_original_request_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Original request % not found', p_original_request_id;
  END IF;

  IF v_original.status IN ('redirected', 'handed_off', 'cancelled') THEN
    RAISE EXCEPTION 'Request % has already been closed (status: %)',
      p_original_request_id, v_original.status;
  END IF;

  v_original_address := COALESCE(v_original.place_address, 'unknown address');

  -- Create new request at new address
  v_new_request_id := trapper.find_or_create_request(
    p_source_system := 'atlas_ui',
    p_source_record_id := 'redirect_from_' || p_original_request_id::TEXT || '_' || EXTRACT(EPOCH FROM v_redirect_at)::TEXT,
    p_source_created_at := v_redirect_at,
    p_place_id := p_new_place_id,
    p_raw_address := p_new_address,
    p_requester_email := COALESCE(p_new_requester_email, (
      SELECT id_value FROM trapper.person_identifiers
      WHERE person_id = v_original.requester_person_id AND id_type = 'email' LIMIT 1
    )),
    p_requester_phone := COALESCE(p_new_requester_phone, (
      SELECT id_value FROM trapper.person_identifiers
      WHERE person_id = v_original.requester_person_id AND id_type = 'phone' LIMIT 1
    )),
    p_requester_name := COALESCE(p_new_requester_name, v_original.requester_display_name),
    p_summary := COALESCE(p_summary, 'Redirected: ' || COALESCE(v_original.summary, 'Request')),
    p_notes := COALESCE(p_notes, '') ||
      E'\n\n--- Redirect History ---' ||
      E'\nRedirected from: ' || v_original_address ||
      E'\nReason: ' || p_redirect_reason ||
      E'\nOriginal request: ' || p_original_request_id::TEXT,
    p_estimated_cat_count := COALESCE(p_estimated_cat_count, v_original.estimated_cat_count),
    p_has_kittens := COALESCE(p_has_kittens, v_original.has_kittens),
    p_kitten_count := COALESCE(p_kitten_count, v_original.kitten_count),
    p_kitten_age_weeks := COALESCE(p_kitten_age_weeks, v_original.kitten_age_weeks),
    p_kitten_assessment_status := p_kitten_assessment_status,
    p_kitten_assessment_outcome := p_kitten_assessment_outcome,
    p_kitten_not_needed_reason := p_kitten_not_needed_reason,
    p_status := 'new',
    p_priority := v_original.priority::TEXT,
    p_created_by := p_created_by
  );

  -- Link new request back to original
  UPDATE trapper.sot_requests
  SET
    redirected_from_request_id = p_original_request_id,
    transfer_type = 'redirect'
  WHERE request_id = v_new_request_id;

  -- Close original as redirected
  UPDATE trapper.sot_requests
  SET
    status = 'redirected'::trapper.request_status,
    redirected_to_request_id = v_new_request_id,
    redirect_reason = p_redirect_reason,
    redirect_at = v_redirect_at,
    transfer_type = 'redirect',
    resolved_at = v_redirect_at,
    resolution_notes = 'Redirected to ' || p_new_address ||
                       E'\nReason: ' || p_redirect_reason,
    updated_at = NOW()
  WHERE request_id = p_original_request_id;

  -- Audit log
  INSERT INTO trapper.entity_edits (
    entity_type, entity_id, edit_type, field_name,
    old_value, new_value, reason, edit_source, edited_by
  ) VALUES (
    'request', p_original_request_id, 'field_update', 'status',
    to_jsonb(v_original.status::TEXT), '"redirected"',
    'Redirected: ' || p_redirect_reason,
    'api', p_created_by
  );

  RETURN QUERY SELECT p_original_request_id, v_new_request_id, 'success'::TEXT;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.redirect_request IS
'Redirects a request to a new address with full kitten assessment support.

New kitten parameters: p_has_kittens, p_kitten_count, p_kitten_age_weeks,
p_kitten_assessment_status, p_kitten_assessment_outcome, p_kitten_not_needed_reason.

Kitten count and age default to original request values. Assessment status/outcome
do NOT copy (requires re-assessment at new location).';

-- ============================================================================
-- SUMMARY
-- ============================================================================

\echo ''
\echo '=============================================='
\echo 'MIG_537 Complete!'
\echo '=============================================='
\echo ''
\echo 'Added column:'
\echo '  - sot_requests.kitten_not_needed_reason'
\echo ''
\echo 'Updated functions:'
\echo '  - find_or_create_request: Added kitten_count, kitten_age_weeks,'
\echo '                            kitten_assessment_status, kitten_assessment_outcome,'
\echo '                            kitten_not_needed_reason'
\echo '  - handoff_request: Added full kitten assessment parameters'
\echo '  - redirect_request: Added full kitten assessment parameters'
\echo ''
\echo 'Kitten fields default to original request values (count, age).'
\echo 'Assessment status/outcome do NOT copy - requires re-assessment.'
\echo 'Use kitten_assessment_status = "not_needed" with reason for skipping.'
\echo ''
