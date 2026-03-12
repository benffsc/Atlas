-- MIG_2916: Handoff — Copy place-specific data from original request
--
-- Fixes FFS-482: When handing off a request, ~35 place/site-specific fields
-- (trapping logistics, colony info, feeding, property/access, medical) were
-- dropped because ops.handoff_request() only passed core fields to
-- find_or_create_request(). The new caretaker is often at the same location,
-- so site characteristics should carry over by default.
--
-- Fix: After creating the new request, UPDATE it with all place-specific
-- fields from the original request.

-- Drop all known overloads so we get a clean single function
DROP FUNCTION IF EXISTS ops.handoff_request(uuid, text, text, text, text, text, uuid, text, text, integer, boolean, integer, integer, text, text, text, text);
DROP FUNCTION IF EXISTS ops.handoff_request(uuid, text, text, text, text, text, uuid, text, text, integer, boolean, integer, integer, text, text, text, text, text, boolean, boolean);
DROP FUNCTION IF EXISTS ops.handoff_request(uuid, text, text, text, text, text, uuid, text, text, integer, boolean, integer, integer, text, text, text, text, text, boolean, boolean, uuid);

CREATE OR REPLACE FUNCTION ops.handoff_request(
  p_original_request_id UUID,
  p_handoff_reason TEXT,
  p_new_address TEXT,
  p_new_requester_name TEXT,
  p_new_requester_phone TEXT DEFAULT NULL,
  p_new_requester_email TEXT DEFAULT NULL,
  p_new_requester_person_id UUID DEFAULT NULL,
  p_summary TEXT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL,
  p_estimated_cat_count INT DEFAULT NULL,
  p_has_kittens BOOLEAN DEFAULT FALSE,
  p_kitten_count INT DEFAULT NULL,
  p_kitten_age_weeks INT DEFAULT NULL,
  p_kitten_assessment_status TEXT DEFAULT NULL,
  p_kitten_assessment_outcome TEXT DEFAULT NULL,
  p_kitten_not_needed_reason TEXT DEFAULT NULL,
  p_created_by TEXT DEFAULT 'handoff_workflow',
  -- V2 fields (MIG_2854)
  p_new_person_role TEXT DEFAULT NULL,
  p_is_property_owner BOOLEAN DEFAULT NULL,
  p_new_person_is_site_contact BOOLEAN DEFAULT TRUE,
  p_resolved_place_id UUID DEFAULT NULL
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
  v_new_place_id UUID;
  v_resolved_person_id UUID;
BEGIN
  -- Get original request details
  SELECT
    r.*,
    p.formatted_address AS place_address,
    p.display_name AS place_name
  INTO v_original
  FROM ops.requests r
  LEFT JOIN sot.places p ON p.place_id = r.place_id
  WHERE r.request_id = p_original_request_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Original request % not found', p_original_request_id;
  END IF;

  IF v_original.status IN ('redirected', 'handed_off', 'cancelled') THEN
    RAISE EXCEPTION 'Request % has already been closed (status: %)',
      p_original_request_id, v_original.status;
  END IF;

  v_original_address := COALESCE(v_original.place_address, v_original.place_name, 'unknown address');

  -- Use pre-resolved place_id if provided (from PlaceResolver), else resolve from address
  IF p_resolved_place_id IS NOT NULL THEN
    SELECT place_id INTO v_new_place_id
    FROM sot.places
    WHERE place_id = p_resolved_place_id AND merged_into_place_id IS NULL;

    IF v_new_place_id IS NULL AND p_new_address IS NOT NULL AND p_new_address != '' THEN
      v_new_place_id := sot.find_or_create_place_deduped(
        p_formatted_address := p_new_address,
        p_display_name := NULL,
        p_lat := NULL,
        p_lng := NULL,
        p_source_system := 'atlas_ui'
      );
    END IF;
  ELSIF p_new_address IS NOT NULL AND p_new_address != '' THEN
    v_new_place_id := sot.find_or_create_place_deduped(
      p_formatted_address := p_new_address,
      p_display_name := NULL,
      p_lat := NULL,
      p_lng := NULL,
      p_source_system := 'atlas_ui'
    );
  END IF;

  -- Create new request via ops.find_or_create_request
  v_new_request_id := ops.find_or_create_request(
    p_source_system := 'atlas_ui',
    p_source_record_id := 'handoff_from_' || p_original_request_id::TEXT || '_' || EXTRACT(EPOCH FROM v_handoff_at)::TEXT,
    p_source_created_at := v_handoff_at,
    p_place_id := v_new_place_id,
    p_requester_person_id := p_new_requester_person_id,
    p_requester_email := p_new_requester_email,
    p_requester_phone := p_new_requester_phone,
    p_requester_name := p_new_requester_name,
    p_summary := COALESCE(p_summary, 'Continuation: ' || COALESCE(v_original.summary, 'Colony care')),
    p_notes := COALESCE(p_notes, '') ||
      E'\n\n--- Handoff History ---' ||
      E'\nContinued from: ' || v_original_address ||
      E'\nHandoff reason: ' || p_handoff_reason ||
      E'\nOriginal request: ' || p_original_request_id::TEXT,
    p_estimated_cat_count := COALESCE(p_estimated_cat_count, v_original.estimated_cat_count),
    p_has_kittens := COALESCE(p_has_kittens, v_original.has_kittens),
    p_kitten_count := p_kitten_count,
    p_kitten_age_weeks := p_kitten_age_weeks,
    p_kitten_assessment_status := p_kitten_assessment_status,
    p_kitten_assessment_outcome := p_kitten_assessment_outcome,
    p_kitten_not_needed_reason := p_kitten_not_needed_reason,
    p_status := 'new',
    p_priority := v_original.priority::TEXT
  );

  -- Resolve the actual person_id on the new request.
  SELECT requester_person_id INTO v_resolved_person_id
  FROM ops.requests WHERE request_id = v_new_request_id;

  -- ============================================================
  -- Copy place-specific data from original request (FFS-482)
  -- These are site characteristics that don't change with a new caretaker.
  -- ============================================================
  UPDATE ops.requests SET
    -- Trapping logistics
    dogs_on_site          = v_original.dogs_on_site,
    trap_savvy            = v_original.trap_savvy,
    previous_tnr          = v_original.previous_tnr,
    handleability         = v_original.handleability,
    fixed_status          = v_original.fixed_status,
    ownership_status      = v_original.ownership_status,
    best_trapping_time    = v_original.best_trapping_time,
    important_notes       = v_original.important_notes,

    -- Colony info
    colony_duration       = v_original.colony_duration,
    location_description  = v_original.location_description,
    total_cats_reported   = v_original.total_cats_reported,
    eartip_count_observed = v_original.eartip_count_observed,
    eartip_estimate       = v_original.eartip_estimate,
    count_confidence      = v_original.count_confidence,
    cats_are_friendly     = v_original.cats_are_friendly,

    -- Feeding
    is_being_fed          = v_original.is_being_fed,
    feeder_name           = v_original.feeder_name,
    feeding_frequency     = v_original.feeding_frequency,
    feeding_location      = v_original.feeding_location,
    feeding_time          = v_original.feeding_time,
    best_times_seen       = v_original.best_times_seen,
    best_contact_times    = v_original.best_contact_times,

    -- Property/access
    permission_status     = v_original.permission_status,
    property_owner_name   = v_original.property_owner_name,
    property_owner_phone  = v_original.property_owner_phone,
    property_type         = v_original.property_type,
    has_property_access   = v_original.has_property_access,
    access_notes          = v_original.access_notes,
    traps_overnight_safe  = v_original.traps_overnight_safe,
    access_without_contact = v_original.access_without_contact,

    -- Medical/urgency
    has_medical_concerns  = v_original.has_medical_concerns,
    medical_description   = v_original.medical_description,
    urgency_reasons       = v_original.urgency_reasons,
    urgency_deadline      = v_original.urgency_deadline,
    urgency_notes         = v_original.urgency_notes,

    -- Link back to original + V2 fields
    redirected_from_request_id = p_original_request_id,
    transfer_type         = 'handoff',
    site_contact_person_id = CASE
      WHEN COALESCE(p_new_person_is_site_contact, TRUE) THEN v_resolved_person_id
      ELSE NULL
    END,
    requester_is_site_contact = COALESCE(p_new_person_is_site_contact, TRUE),
    requester_role_at_submission = p_new_person_role,
    is_property_owner     = p_is_property_owner
  WHERE request_id = v_new_request_id;

  -- Create person-place relationship with specified role
  IF v_resolved_person_id IS NOT NULL
     AND v_new_place_id IS NOT NULL
     AND p_new_person_role IS NOT NULL THEN
    INSERT INTO sot.person_place (
      person_id, place_id, relationship_type,
      evidence_type, confidence, source_system
    ) VALUES (
      v_resolved_person_id, v_new_place_id, p_new_person_role,
      'manual', 1.0, 'atlas_ui'
    )
    ON CONFLICT (person_id, place_id, relationship_type)
    DO UPDATE SET
      confidence = GREATEST(sot.person_place.confidence, 1.0),
      updated_at = NOW();
  END IF;

  -- Close original as handed_off
  UPDATE ops.requests
  SET
    status = 'handed_off',
    redirected_to_request_id = v_new_request_id,
    redirect_reason = p_handoff_reason,
    redirect_at = v_handoff_at,
    transfer_type = 'handoff',
    resolved_at = v_handoff_at,
    resolution_notes = 'Handed off to ' || p_new_requester_name || ' at ' || p_new_address ||
                       E'\nReason: ' || p_handoff_reason,
    updated_at = NOW()
  WHERE request_id = p_original_request_id;

  -- Audit log
  INSERT INTO sot.entity_edits (
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

COMMENT ON FUNCTION ops.handoff_request IS
'Hands off a request to a new caretaker. Creates a new request linked to the
original, copying all place-specific data (trapping logistics, colony info,
feeding, property/access, medical/urgency) from the original.

MIG_2854: V2 fields (person role, property owner, site contact)
MIG_2916: Copy ~35 place-specific fields (FFS-482)';
