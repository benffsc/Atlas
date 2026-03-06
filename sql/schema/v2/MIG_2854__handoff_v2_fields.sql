-- MIG_2854__handoff_v2_fields.sql
-- Date: 2026-03-06
--
-- PURPOSE: Extend ops.handoff_request() with V2 fields for person role,
-- property ownership, and site contact designation. After creating the
-- new request, set V2 columns and create person-place relationship.
--
-- Fixes FFS-273
--
-- Run: psql "$DATABASE_URL" -f sql/schema/v2/MIG_2854__handoff_v2_fields.sql

\echo ''
\echo '=============================================='
\echo '  MIG_2854: Handoff V2 Fields'
\echo '=============================================='
\echo ''

-- ============================================================================
-- 1. EXTEND PERSON_PLACE RELATIONSHIP_TYPE CONSTRAINT
-- ============================================================================

\echo '1. Extending person_place relationship_type constraint...'

-- Add 'landlord' and 'property_manager' to allowed values
ALTER TABLE sot.person_place DROP CONSTRAINT IF EXISTS person_place_relationship_type_check;

ALTER TABLE sot.person_place ADD CONSTRAINT person_place_relationship_type_check
CHECK (relationship_type IN (
  -- Residence types
  'resident',
  'property_owner',

  -- Property management
  'landlord',
  'property_manager',

  -- Colony caretaker hierarchy
  'colony_caretaker',
  'colony_supervisor',
  'feeder',

  -- Transport/logistics
  'transporter',

  -- Referral/contact
  'referrer',
  'neighbor',

  -- Work/volunteer
  'works_at',
  'volunteers_at',

  -- Automated/unverified
  'contact_address',

  -- Legacy
  'owner',
  'manager',
  'caretaker',
  'requester',
  'trapper_at'
));

\echo '   Added landlord, property_manager to person_place relationship types'

-- ============================================================================
-- 2. RECREATE ops.handoff_request WITH V2 FIELDS
-- ============================================================================

\echo ''
\echo '2. Recreating ops.handoff_request with V2 fields...'

-- Drop old signatures if they exist
DROP FUNCTION IF EXISTS ops.handoff_request(uuid, text, text, text, text, text, uuid, text, text, integer, boolean, integer, integer, text, text, text, text);
DROP FUNCTION IF EXISTS ops.handoff_request(uuid, text, text, text, text, text, uuid, text, text, integer, boolean, integer, integer, text, text, text, text, text, boolean, boolean);

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
  p_resolved_place_id UUID DEFAULT NULL  -- skip re-resolution when frontend already resolved
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
    -- Verify the place exists and isn't merged
    SELECT place_id INTO v_new_place_id
    FROM sot.places
    WHERE place_id = p_resolved_place_id AND merged_into_place_id IS NULL;

    -- If merged or missing, fall back to address resolution
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
  -- When p_new_requester_person_id is NULL, find_or_create_request may have
  -- resolved a person via email/phone internally. We need that resolved ID
  -- for V2 fields and person-place relationship creation.
  SELECT requester_person_id INTO v_resolved_person_id
  FROM ops.requests WHERE request_id = v_new_request_id;

  -- Link new request back to original
  UPDATE ops.requests
  SET
    redirected_from_request_id = p_original_request_id,
    transfer_type = 'handoff'
  WHERE request_id = v_new_request_id;

  -- Set V2 fields on the new request (use resolved person, not just the input param)
  UPDATE ops.requests SET
    site_contact_person_id = CASE
      WHEN COALESCE(p_new_person_is_site_contact, TRUE) THEN v_resolved_person_id
      ELSE NULL
    END,
    requester_is_site_contact = COALESCE(p_new_person_is_site_contact, TRUE),
    requester_role_at_submission = p_new_person_role,
    is_property_owner = p_is_property_owner
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
'V2 handoff_request with person role and property context fields (MIG_2854).

Hands off a request to a new caretaker. Creates a new request linked to the
original. Sets V2 fields (site_contact_person_id, requester_role_at_submission,
is_property_owner) on the new request and creates person-place relationship.

New params (MIG_2854):
  p_new_person_role - Relationship type (owner, resident, landlord, etc.)
  p_is_property_owner - Whether new person owns the property
  p_new_person_is_site_contact - Whether new person is on-site contact (default TRUE)';

-- ============================================================================
-- 3. VERIFICATION
-- ============================================================================

\echo ''
\echo '=============================================='
\echo '  VERIFICATION'
\echo '=============================================='
\echo ''

DO $$
DECLARE
    v_param_count INT;
BEGIN
    SELECT pronargs INTO v_param_count
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'ops' AND p.proname = 'handoff_request';

    RAISE NOTICE 'ops.handoff_request: % params (expected 21)', v_param_count;
END $$;

\echo ''
\echo '=============================================='
\echo '  MIG_2854 Complete'
\echo '=============================================='
\echo ''
\echo 'Extended ops.handoff_request() with V2 fields:'
\echo '  - p_new_person_role (TEXT)'
\echo '  - p_is_property_owner (BOOLEAN)'
\echo '  - p_new_person_is_site_contact (BOOLEAN, default TRUE)'
\echo ''
\echo 'Extended sot.person_place constraint with:'
\echo '  - landlord'
\echo '  - property_manager'
\echo ''
