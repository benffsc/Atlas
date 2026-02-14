-- MIG_194: Internal Notes Field
-- Separates case info (public/shared) from internal notes (staff working notes)
--
-- Problem: "notes" field conflates case info with internal staff notes
-- In Airtable:
--   - Case Info = detailed situation description (shared context)
--   - Internal Notes = staff working notes (private)
--
-- Solution: Add internal_notes field, keep notes as case_info

\echo '=============================================='
\echo 'MIG_194: Internal Notes Field'
\echo '=============================================='

-- ============================================
-- PART 1: Add internal_notes to sot_requests
-- ============================================

\echo 'Adding internal_notes column to sot_requests...'

ALTER TABLE trapper.sot_requests
  ADD COLUMN IF NOT EXISTS internal_notes TEXT;

COMMENT ON COLUMN trapper.sot_requests.notes IS
'Case information - detailed situation description (can be shared with clients)';

COMMENT ON COLUMN trapper.sot_requests.internal_notes IS
'Internal staff notes - working notes, private, not shared with clients';

-- ============================================
-- PART 2: Add to raw_intake_request
-- ============================================

\echo 'Adding internal_notes to raw_intake_request...'

ALTER TABLE trapper.raw_intake_request
  ADD COLUMN IF NOT EXISTS raw_internal_notes TEXT;

-- ============================================
-- PART 3: Update promote_intake_request
-- ============================================

\echo 'Updating promote_intake_request function...'

-- Note: The promote function already handles notes.
-- internal_notes will be added manually post-creation typically,
-- but we add support for it in promotion for completeness.

CREATE OR REPLACE FUNCTION trapper.promote_intake_request(
  p_raw_id UUID,
  p_promoted_by TEXT DEFAULT 'system'
) RETURNS UUID AS $$
DECLARE
  v_raw RECORD;
  v_request_id UUID;
  v_place_id UUID;
  v_person_id UUID;
BEGIN
  -- Get the raw intake record
  SELECT * INTO v_raw
  FROM trapper.raw_intake_request
  WHERE raw_id = p_raw_id
    AND intake_status IN ('pending', 'validated', 'needs_review');

  IF v_raw IS NULL THEN
    RETURN NULL;
  END IF;

  -- Use existing place_id if provided
  v_place_id := v_raw.place_id;

  -- Use existing person_id if provided
  v_person_id := v_raw.requester_person_id;

  -- Create the request
  INSERT INTO trapper.sot_requests (
    -- Request Purpose
    request_purpose,
    -- Location
    place_id,
    property_type,
    location_description,
    -- Contact
    requester_person_id,
    property_owner_contact,
    property_owner_name,
    property_owner_phone,
    best_contact_times,
    -- Permission & Access
    permission_status,
    access_notes,
    traps_overnight_safe,
    access_without_contact,
    authorization_pending,
    -- About the Cats
    estimated_cat_count,
    wellness_cat_count,
    count_confidence,
    colony_duration,
    eartip_count,
    eartip_estimate,
    cats_are_friendly,
    -- Kittens
    has_kittens,
    kitten_count,
    kitten_age_weeks,
    -- Feeding
    is_being_fed,
    feeder_name,
    feeding_schedule,
    best_times_seen,
    -- Urgency
    urgency_reasons,
    urgency_deadline,
    urgency_notes,
    priority,
    -- Additional
    summary,
    notes,
    internal_notes,
    -- Meta
    data_source,
    source_system,
    created_by
  ) VALUES (
    COALESCE(v_raw.raw_request_purpose, 'tnr')::trapper.request_purpose,
    v_place_id,
    v_raw.raw_property_type::trapper.property_type,
    v_raw.raw_location_description,
    v_person_id,
    v_raw.raw_property_owner_contact,
    v_raw.raw_property_owner_name,
    v_raw.raw_property_owner_phone,
    v_raw.raw_best_contact_times,
    COALESCE(v_raw.raw_permission_status, 'unknown')::trapper.permission_status,
    v_raw.raw_access_notes,
    v_raw.raw_traps_overnight_safe,
    v_raw.raw_access_without_contact,
    COALESCE(v_raw.raw_authorization_pending, FALSE),
    v_raw.raw_estimated_cat_count,
    v_raw.raw_wellness_cat_count,
    COALESCE(v_raw.raw_count_confidence, 'unknown')::trapper.count_confidence,
    COALESCE(v_raw.raw_colony_duration, 'unknown')::trapper.colony_duration,
    v_raw.raw_eartip_count,
    COALESCE(v_raw.raw_eartip_estimate, 'unknown')::trapper.eartip_estimate,
    v_raw.raw_cats_are_friendly,
    COALESCE(v_raw.raw_has_kittens, FALSE),
    v_raw.raw_kitten_count,
    v_raw.raw_kitten_age_weeks,
    v_raw.raw_is_being_fed,
    v_raw.raw_feeder_name,
    v_raw.raw_feeding_schedule,
    v_raw.raw_best_times_seen,
    v_raw.raw_urgency_reasons,
    v_raw.raw_urgency_deadline,
    v_raw.raw_urgency_notes,
    COALESCE(v_raw.raw_priority, 'normal')::trapper.request_priority,
    v_raw.raw_summary,
    v_raw.raw_notes,
    v_raw.raw_internal_notes,
    'app',
    v_raw.source_system,
    p_promoted_by
  )
  RETURNING request_id INTO v_request_id;

  -- Update raw record as promoted
  UPDATE trapper.raw_intake_request
  SET intake_status = 'promoted',
      promoted_request_id = v_request_id,
      promoted_at = NOW(),
      promoted_by = p_promoted_by
  WHERE raw_id = p_raw_id;

  -- Log to audit
  INSERT INTO trapper.intake_audit_log (
    raw_table, raw_id, sot_table, sot_id,
    action, promoted_by, promotion_reason
  ) VALUES (
    'raw_intake_request', p_raw_id, 'sot_requests', v_request_id,
    'create', p_promoted_by, 'standard_promotion'
  );

  RETURN v_request_id;
END;
$$ LANGUAGE plpgsql;

\echo ''
\echo 'MIG_194 complete!'
\echo ''
\echo 'Added:'
\echo '  - Column: sot_requests.internal_notes'
\echo '  - Column: raw_intake_request.raw_internal_notes'
\echo ''
\echo 'Field meanings:'
\echo '  - summary: Request title/headline'
\echo '  - notes: Case info - detailed situation (can share with clients)'
\echo '  - internal_notes: Staff working notes (private)'
