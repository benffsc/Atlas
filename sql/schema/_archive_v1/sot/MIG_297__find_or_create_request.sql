-- MIG_297: Centralized Request Creation Function
--
-- Creates find_or_create_request() to standardize request creation across
-- all ingest scripts and APIs, similar to find_or_create_person() and
-- find_or_create_place_deduped().
--
-- Per CLAUDE.md guidelines, this prevents direct INSERTs to sot_requests
-- and ensures consistent handling of:
--   - Deduplication by source_system + source_record_id
--   - Auto-creation of places from raw address
--   - Auto-creation of people from contact info
--   - Proper audit logging
--   - Consistent source_created_at handling for attribution windows
--
-- MANUAL APPLY:
--   source .env && psql "$DATABASE_URL" -f sql/schema/sot/MIG_297__find_or_create_request.sql

\echo ''
\echo 'MIG_297: Centralized Request Creation Function'
\echo '==============================================='
\echo ''

-- ============================================
-- 1. Main find_or_create_request function
-- ============================================

\echo 'Creating find_or_create_request function...'

CREATE OR REPLACE FUNCTION trapper.find_or_create_request(
  -- Source identification (required)
  p_source_system TEXT,           -- Must be 'airtable', 'clinichq', 'web_intake', or 'atlas_ui'
  p_source_record_id TEXT,        -- Original ID in source system (for deduplication)
  p_source_created_at TIMESTAMPTZ DEFAULT NULL, -- Original creation date (important for attribution windows!)

  -- Location: Either provide place_id OR raw_address (will auto-create place)
  p_place_id UUID DEFAULT NULL,
  p_raw_address TEXT DEFAULT NULL,

  -- Requester: Either provide person_id OR contact info (will auto-create person)
  p_requester_person_id UUID DEFAULT NULL,
  p_requester_email TEXT DEFAULT NULL,
  p_requester_phone TEXT DEFAULT NULL,
  p_requester_name TEXT DEFAULT NULL,

  -- Request details
  p_summary TEXT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL,
  p_estimated_cat_count INT DEFAULT NULL,
  p_status TEXT DEFAULT 'new',
  p_priority TEXT DEFAULT 'normal',

  -- Optional details
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
  v_resolved_person_id UUID;
  v_source_created TIMESTAMPTZ;
BEGIN
  -- Validate source_system
  IF p_source_system NOT IN ('airtable', 'clinichq', 'web_intake', 'atlas_ui') THEN
    RAISE EXCEPTION 'Invalid source_system "%". Must be one of: airtable, clinichq, web_intake, atlas_ui', p_source_system;
  END IF;

  -- Check for existing request by source_system + source_record_id
  IF p_source_record_id IS NOT NULL THEN
    SELECT request_id INTO v_request_id
    FROM trapper.sot_requests
    WHERE source_system = p_source_system
      AND source_record_id = p_source_record_id;

    IF v_request_id IS NOT NULL THEN
      -- Update existing request with new data
      UPDATE trapper.sot_requests
      SET
        summary = COALESCE(p_summary, summary),
        notes = COALESCE(p_notes, notes),
        estimated_cat_count = COALESCE(p_estimated_cat_count, estimated_cat_count),
        has_kittens = COALESCE(p_has_kittens, has_kittens),
        updated_at = NOW()
      WHERE request_id = v_request_id;

      RETURN v_request_id;
    END IF;
  END IF;

  -- Resolve place_id
  v_resolved_place_id := p_place_id;

  -- If no place_id but raw_address provided, create/find the place
  IF v_resolved_place_id IS NULL AND p_raw_address IS NOT NULL AND p_raw_address != '' THEN
    v_resolved_place_id := trapper.find_or_create_place_deduped(
      p_formatted_address := p_raw_address,
      p_display_name := NULL,
      p_latitude := NULL,  -- Will be geocoded later
      p_longitude := NULL,
      p_source_system := p_source_system
    );
  END IF;

  -- Resolve requester_person_id
  v_resolved_person_id := p_requester_person_id;

  -- If no person_id but contact info provided, create/find the person
  IF v_resolved_person_id IS NULL AND (p_requester_email IS NOT NULL OR p_requester_phone IS NOT NULL) THEN
    v_resolved_person_id := trapper.find_or_create_person(
      p_email := p_requester_email,
      p_phone := p_requester_phone,
      p_first_name := SPLIT_PART(COALESCE(p_requester_name, ''), ' ', 1),
      p_last_name := NULLIF(SUBSTRING(p_requester_name FROM POSITION(' ' IN p_requester_name) + 1), ''),
      p_display_name := p_requester_name,
      p_source_system := p_source_system
    );

    -- Link person to place if both exist
    IF v_resolved_person_id IS NOT NULL AND v_resolved_place_id IS NOT NULL THEN
      INSERT INTO trapper.person_place_relationships (
        person_id, place_id, role, confidence, source_system
      ) VALUES (
        v_resolved_person_id, v_resolved_place_id, 'requester', 0.80, p_source_system
      )
      ON CONFLICT (person_id, place_id, role) DO NOTHING;
    END IF;
  END IF;

  -- Set source_created_at (critical for attribution windows!)
  v_source_created := COALESCE(p_source_created_at, NOW());

  -- Create the request
  INSERT INTO trapper.sot_requests (
    -- Location
    place_id,
    -- Requester
    requester_person_id,
    -- Details
    summary,
    notes,
    internal_notes,
    estimated_cat_count,
    has_kittens,
    cats_are_friendly,
    request_purpose,
    -- Status
    status,
    priority,
    -- Provenance
    source_system,
    source_record_id,
    source_created_at,
    data_source,
    created_by,
    -- Timestamps
    created_at,
    updated_at
  ) VALUES (
    v_resolved_place_id,
    v_resolved_person_id,
    p_summary,
    p_notes,
    p_internal_notes,
    p_estimated_cat_count,
    p_has_kittens,
    p_cats_are_friendly,
    NULLIF(p_request_purpose, '')::trapper.request_purpose,
    NULLIF(p_status, '')::trapper.request_status,
    NULLIF(p_priority, '')::trapper.request_priority,
    p_source_system,
    p_source_record_id,
    v_source_created,
    'app'::trapper.data_source,
    p_created_by,
    NOW(),
    NOW()
  )
  RETURNING request_id INTO v_request_id;

  -- Log to entity_edits for audit trail
  INSERT INTO trapper.entity_edits (
    entity_type,
    entity_id,
    field_name,
    old_value,
    new_value,
    edit_reason,
    edited_by,
    edit_source
  ) VALUES (
    'request',
    v_request_id,
    '_created',
    NULL,
    jsonb_build_object(
      'source_system', p_source_system,
      'source_record_id', p_source_record_id,
      'place_id', v_resolved_place_id,
      'person_id', v_resolved_person_id,
      'place_created_from_address', (p_place_id IS NULL AND p_raw_address IS NOT NULL),
      'person_created_from_contact', (p_requester_person_id IS NULL AND v_resolved_person_id IS NOT NULL)
    ),
    'request_creation',
    COALESCE(p_created_by, 'find_or_create_request'),
    'function'
  );

  RETURN v_request_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.find_or_create_request IS
'Centralized function for creating requests. Per CLAUDE.md, ALWAYS use this instead of direct INSERT.

Features:
  - Deduplicates by source_system + source_record_id
  - Auto-creates places from raw_address using find_or_create_place_deduped
  - Auto-creates people from contact info using find_or_create_person
  - Properly tracks source_created_at for attribution windows
  - Logs creation to entity_edits for audit trail

Required params:
  - p_source_system: Must be airtable, clinichq, web_intake, or atlas_ui
  - p_source_record_id: Original ID in source system (for dedup)

Example usage:
  SELECT trapper.find_or_create_request(
    p_source_system := ''airtable'',
    p_source_record_id := ''rec123abc'',
    p_source_created_at := ''2025-01-15''::timestamptz,
    p_raw_address := ''123 Main St, Santa Rosa, CA'',
    p_requester_email := ''owner@example.com'',
    p_requester_phone := ''707-555-1234'',
    p_requester_name := ''Jane Doe'',
    p_summary := ''Colony of 5 cats needs TNR'',
    p_estimated_cat_count := 5
  );';

-- ============================================
-- 2. Simpler wrapper for intake conversion
-- ============================================

\echo 'Creating create_request_from_intake function...'

CREATE OR REPLACE FUNCTION trapper.create_request_from_intake(
  p_submission_id UUID,
  p_created_by TEXT DEFAULT 'system'
)
RETURNS UUID AS $$
DECLARE
  v_submission RECORD;
  v_request_id UUID;
  v_full_address TEXT;
BEGIN
  -- Get the submission
  SELECT * INTO v_submission
  FROM trapper.web_intake_submissions
  WHERE submission_id = p_submission_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Submission % not found', p_submission_id;
  END IF;

  -- Check if already converted
  IF v_submission.created_request_id IS NOT NULL THEN
    RETURN v_submission.created_request_id;
  END IF;

  -- Build full address
  v_full_address := v_submission.cats_address;
  IF v_submission.cats_city IS NOT NULL AND v_submission.cats_city != '' THEN
    v_full_address := v_full_address || ', ' || v_submission.cats_city;
  END IF;

  -- Create the request using centralized function
  v_request_id := trapper.find_or_create_request(
    p_source_system := 'web_intake',
    p_source_record_id := v_submission.submission_id::TEXT,
    p_source_created_at := v_submission.submitted_at,
    p_place_id := v_submission.place_id,
    p_raw_address := CASE WHEN v_submission.place_id IS NULL THEN v_full_address ELSE NULL END,
    p_requester_person_id := v_submission.matched_person_id,
    p_requester_email := CASE WHEN v_submission.matched_person_id IS NULL THEN v_submission.email ELSE NULL END,
    p_requester_phone := CASE WHEN v_submission.matched_person_id IS NULL THEN v_submission.phone ELSE NULL END,
    p_requester_name := CASE WHEN v_submission.matched_person_id IS NULL THEN v_submission.first_name || ' ' || v_submission.last_name ELSE NULL END,
    p_summary := COALESCE(
      v_submission.triage_category,
      CASE
        WHEN v_submission.is_emergency THEN 'EMERGENCY: '
        ELSE ''
      END || COALESCE(v_submission.ownership_status, '') || ' - ' ||
      COALESCE(v_submission.cat_count_estimate::TEXT, '?') || ' cats'
    ),
    p_notes := v_submission.situation_description,
    p_estimated_cat_count := v_submission.cat_count_estimate,
    p_has_kittens := COALESCE(v_submission.has_kittens, FALSE),
    p_priority := CASE WHEN v_submission.is_emergency THEN 'urgent' ELSE 'normal' END,
    p_created_by := p_created_by
  );

  -- Update the submission to link to the request
  UPDATE trapper.web_intake_submissions
  SET
    created_request_id = v_request_id,
    submission_status = 'complete'::trapper.intake_submission_status,
    updated_at = NOW()
  WHERE submission_id = p_submission_id;

  RETURN v_request_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.create_request_from_intake IS
'Converts an intake submission to a sot_request using find_or_create_request.
Links the submission to the new request and marks it complete.

Usage:
  SELECT trapper.create_request_from_intake(
    p_submission_id := ''abc-123...''::UUID,
    p_created_by := ''staff_name''
  );';

-- ============================================
-- 3. Verification
-- ============================================

\echo ''
\echo 'Verifying functions...'

SELECT
  proname AS function_name,
  pg_get_function_arguments(oid) AS arguments
FROM pg_proc
WHERE proname IN ('find_or_create_request', 'create_request_from_intake')
  AND pronamespace = 'trapper'::regnamespace;

\echo ''
\echo 'MIG_297 complete!'
\echo ''
\echo 'New functions:'
\echo '  - find_or_create_request() - Centralized request creation with dedup and auto-linking'
\echo '  - create_request_from_intake() - Convert intake submission to request'
\echo ''
\echo 'Usage:'
\echo '  Per CLAUDE.md, ALWAYS use find_or_create_request() instead of direct INSERT.'
\echo '  Valid source_system values: airtable, clinichq, web_intake, atlas_ui'
\echo ''
