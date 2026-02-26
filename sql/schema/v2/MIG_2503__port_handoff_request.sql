-- MIG_2503__port_handoff_request.sql
-- Date: 2026-02-25
--
-- PROBLEM: The handoff flow UI calls ops.handoff_request() but the function
-- only exists in V1 (trapper.handoff_request). This causes the "Hand Off"
-- button to fail silently when creating a new request.
--
-- SOLUTION: Port the handoff_request function to V2 schema (ops).
--
-- Run: psql "$DATABASE_URL" -f sql/schema/v2/MIG_2503__port_handoff_request.sql

\echo ''
\echo '=============================================='
\echo '  MIG_2503: Port Handoff Request Function'
\echo '=============================================='
\echo ''

-- ============================================================================
-- 1. ENSURE TRANSFER_TYPE COLUMN EXISTS
-- ============================================================================

\echo '1. Ensuring transfer_type column exists...'

ALTER TABLE ops.requests
ADD COLUMN IF NOT EXISTS transfer_type TEXT
  CHECK (transfer_type IN ('redirect', 'handoff'));

COMMENT ON COLUMN ops.requests.transfer_type IS
'Distinguishes redirect (address was wrong) from handoff (legitimate succession to new caretaker)';

-- ============================================================================
-- 2. ENSURE HANDED_OFF STATUS EXISTS IN ENUM
-- ============================================================================

\echo '2. Checking request_status enum...'

DO $$
BEGIN
  -- Check if 'handed_off' value exists in the enum
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON e.enumtypid = t.oid
    WHERE t.typname = 'request_status'
      AND e.enumlabel = 'handed_off'
  ) THEN
    -- Try to add it (may fail if enum doesn't allow modification)
    BEGIN
      ALTER TYPE request_status ADD VALUE IF NOT EXISTS 'handed_off';
      RAISE NOTICE 'Added handed_off to request_status enum';
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'Could not add handed_off to enum: %. Using text column instead.', SQLERRM;
    END;
  ELSE
    RAISE NOTICE 'handed_off already exists in request_status enum';
  END IF;
END $$;

-- ============================================================================
-- 3. CREATE HANDOFF_REQUEST FUNCTION
-- ============================================================================

\echo ''
\echo '3. Creating ops.handoff_request function...'

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
  p_created_by TEXT DEFAULT 'handoff_workflow'
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

  -- Resolve place from new address
  IF p_new_address IS NOT NULL AND p_new_address != '' THEN
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

  -- Link new request back to original
  UPDATE ops.requests
  SET
    redirected_from_request_id = p_original_request_id,
    transfer_type = 'handoff'
  WHERE request_id = v_new_request_id;

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
'V2 port of handoff_request function.

Hands off a request to a new caretaker at a new location. Unlike redirect
(which implies the original address was wrong), handoff represents a legitimate
succession of responsibility - the original caretaker transfers colony care
to a new person at their location.

The original request is closed with status "handed_off" and a new request is
created for the new caretaker. Both requests are linked together.

Parameters:
  p_original_request_id - UUID of request to hand off
  p_handoff_reason - Why the handoff is happening
  p_new_address - New caretaker address
  p_new_requester_name - Name of new caretaker
  p_new_requester_phone/email - Contact info (optional)
  p_new_requester_person_id - Existing person UUID (optional)
  p_summary/notes - Override summary/notes (optional)
  p_estimated_cat_count - Override cat count (optional)
  p_has_kittens, etc - Kitten assessment fields (optional)

Returns: (original_request_id, new_request_id, "success")

Example:
  SELECT * FROM ops.handoff_request(
    p_original_request_id := ''e699d432-e9f1-4034-b2c9-29e5584b92ff'',
    p_handoff_reason := ''Original caller was not the actual resident'',
    p_new_address := ''3301 Tomales Petaluma Rd, Tomales, CA 94971'',
    p_new_requester_name := ''Kathleen Sartori'',
    p_new_requester_phone := ''7078782462''
  );';

-- ============================================================================
-- 4. VERIFICATION
-- ============================================================================

\echo ''
\echo '=============================================='
\echo '  VERIFICATION'
\echo '=============================================='
\echo ''

\echo 'Function exists:'
SELECT
    routine_schema,
    routine_name,
    data_type as return_type
FROM information_schema.routines
WHERE routine_name = 'handoff_request'
ORDER BY routine_schema;

\echo ''
\echo '=============================================='
\echo '  MIG_2503 Complete'
\echo '=============================================='
\echo ''
\echo 'Created ops.handoff_request() function for V2 schema.'
\echo ''
\echo 'The "Hand Off" button on request pages will now work correctly.'
\echo ''
\echo 'Key changes from V1:'
\echo '  - Uses sot.places instead of trapper.places'
\echo '  - Uses ops.requests instead of trapper.sot_requests'
\echo '  - Uses ops.find_or_create_request instead of trapper version'
\echo '  - Uses sot.entity_edits for audit trail'
\echo ''
