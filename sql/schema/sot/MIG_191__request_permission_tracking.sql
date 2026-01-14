-- MIG_191: Request Permission Tracking
-- Adds fields to track property authorization status
--
-- Problem: When requestor doesn't have authority over property,
-- we need to track property owner info and pending authorization.

\echo '=============================================='
\echo 'MIG_191: Request Permission Tracking'
\echo '=============================================='

-- ============================================
-- PART 1: Add columns to sot_requests
-- ============================================

\echo 'Adding permission columns to sot_requests...'

ALTER TABLE trapper.sot_requests
  ADD COLUMN IF NOT EXISTS property_owner_name TEXT,
  ADD COLUMN IF NOT EXISTS property_owner_phone TEXT,
  ADD COLUMN IF NOT EXISTS authorization_pending BOOLEAN DEFAULT FALSE;

COMMENT ON COLUMN trapper.sot_requests.property_owner_name IS
'Name of property owner if different from requestor';

COMMENT ON COLUMN trapper.sot_requests.property_owner_phone IS
'Phone number of property owner if different from requestor';

COMMENT ON COLUMN trapper.sot_requests.authorization_pending IS
'TRUE if property authorization has not yet been obtained and needs follow-up';

-- ============================================
-- PART 2: Add columns to raw_intake_request
-- ============================================

\echo 'Adding permission columns to raw_intake_request...'

ALTER TABLE trapper.raw_intake_request
  ADD COLUMN IF NOT EXISTS raw_property_owner_name TEXT,
  ADD COLUMN IF NOT EXISTS raw_property_owner_phone TEXT,
  ADD COLUMN IF NOT EXISTS raw_authorization_pending BOOLEAN;

-- ============================================
-- PART 3: Update promote_intake_request function
-- ============================================

\echo 'Updating promote_intake_request function...'

-- Get the current function to see its signature
-- We need to update it to handle the new fields

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

  -- Use existing place_id if provided, or try to find/create from address
  v_place_id := v_raw.place_id;

  -- Use existing person_id if provided
  v_person_id := v_raw.requester_person_id;

  -- Create the request
  INSERT INTO trapper.sot_requests (
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
    -- Meta
    data_source,
    source_system,
    created_by
  ) VALUES (
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

-- ============================================
-- PART 4: View for pending authorizations
-- ============================================

\echo 'Creating view for pending authorizations...'

CREATE OR REPLACE VIEW trapper.v_requests_pending_authorization AS
SELECT
  r.request_id,
  r.summary,
  r.status::TEXT,
  r.priority::TEXT,
  r.authorization_pending,
  r.property_owner_name,
  r.property_owner_phone,
  r.permission_status::TEXT,
  p.display_name as place_name,
  p.formatted_address,
  per.display_name as requester_name,
  r.created_at
FROM trapper.sot_requests r
LEFT JOIN trapper.places p ON p.place_id = r.place_id
LEFT JOIN trapper.sot_people per ON per.person_id = r.requester_person_id
WHERE r.authorization_pending = TRUE
   OR r.permission_status IN ('pending', 'no')
ORDER BY r.created_at DESC;

\echo ''
\echo 'MIG_191 complete!'
\echo ''
\echo 'New columns added:'
\echo '  - sot_requests.property_owner_name'
\echo '  - sot_requests.property_owner_phone'
\echo '  - sot_requests.authorization_pending'
\echo ''
\echo 'View created: trapper.v_requests_pending_authorization'
