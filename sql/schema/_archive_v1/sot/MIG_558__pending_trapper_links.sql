\echo ''
\echo '=============================================='
\echo 'MIG_558: Pending Trapper Links Queue'
\echo '=============================================='
\echo ''
\echo 'Creates a queue for trappers that could not be'
\echo 'automatically linked via identity resolution.'
\echo ''
\echo 'Staff can manually link these via admin UI.'
\echo ''

BEGIN;

-- ============================================================================
-- PART 1: Create pending_trapper_links table
-- ============================================================================

\echo 'Creating pending_trapper_links table...'

CREATE TABLE IF NOT EXISTS trapper.pending_trapper_links (
  pending_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Airtable source data
  airtable_record_id TEXT NOT NULL,
  display_name TEXT,
  email TEXT,
  phone TEXT,
  address TEXT,
  trapper_type TEXT,  -- 'ffsc_trapper', 'community_trapper', etc.

  -- Why it couldn't be auto-linked
  failure_reason TEXT,  -- 'no_identifiers', 'phone_conflict', 'low_confidence', etc.

  -- Potential matches found (for staff review)
  candidate_person_ids UUID[],
  candidate_scores JSONB,  -- Array of {person_id, score, reason}

  -- Resolution status
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending',    -- Awaiting staff review
    'linked',     -- Staff linked to existing person
    'created',    -- Staff created new person and linked
    'dismissed'   -- Staff dismissed (invalid trapper record)
  )),

  -- Resolution tracking
  resolved_person_id UUID REFERENCES trapper.sot_people(person_id),
  resolved_at TIMESTAMPTZ,
  resolved_by TEXT,
  resolution_notes TEXT,

  -- Audit
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Prevent duplicate queue entries
  CONSTRAINT unique_pending_airtable_record
    UNIQUE (airtable_record_id)
);

CREATE INDEX IF NOT EXISTS idx_pending_trapper_links_status
  ON trapper.pending_trapper_links(status);

CREATE INDEX IF NOT EXISTS idx_pending_trapper_links_created
  ON trapper.pending_trapper_links(created_at DESC);

COMMENT ON TABLE trapper.pending_trapper_links IS
'Queue for Airtable trappers that could not be automatically linked to Atlas people.
Staff resolves these via /admin/trapper-linking UI by either:
1. Linking to existing person
2. Creating new person
3. Dismissing as invalid';

-- ============================================================================
-- PART 2: Function to queue a pending trapper link
-- ============================================================================

\echo 'Creating queue_pending_trapper_link function...'

CREATE OR REPLACE FUNCTION trapper.queue_pending_trapper_link(
  p_airtable_record_id TEXT,
  p_display_name TEXT,
  p_email TEXT DEFAULT NULL,
  p_phone TEXT DEFAULT NULL,
  p_address TEXT DEFAULT NULL,
  p_trapper_type TEXT DEFAULT NULL,
  p_failure_reason TEXT DEFAULT 'unknown',
  p_candidate_person_ids UUID[] DEFAULT NULL,
  p_candidate_scores JSONB DEFAULT NULL
) RETURNS UUID AS $$
DECLARE
  v_pending_id UUID;
BEGIN
  INSERT INTO trapper.pending_trapper_links (
    airtable_record_id, display_name, email, phone, address,
    trapper_type, failure_reason, candidate_person_ids, candidate_scores
  ) VALUES (
    p_airtable_record_id, p_display_name, p_email, p_phone, p_address,
    p_trapper_type, p_failure_reason, p_candidate_person_ids, p_candidate_scores
  )
  ON CONFLICT (airtable_record_id)
  DO UPDATE SET
    display_name = EXCLUDED.display_name,
    email = EXCLUDED.email,
    phone = EXCLUDED.phone,
    address = EXCLUDED.address,
    trapper_type = EXCLUDED.trapper_type,
    failure_reason = EXCLUDED.failure_reason,
    candidate_person_ids = EXCLUDED.candidate_person_ids,
    candidate_scores = EXCLUDED.candidate_scores,
    updated_at = NOW()
  WHERE trapper.pending_trapper_links.status = 'pending'
  RETURNING pending_id INTO v_pending_id;

  RETURN v_pending_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.queue_pending_trapper_link IS
'Add a trapper to the pending links queue for manual resolution.
Idempotent - updates existing pending entry if present.';

-- ============================================================================
-- PART 3: Function to resolve a pending trapper link
-- ============================================================================

\echo 'Creating resolve_pending_trapper_link function...'

CREATE OR REPLACE FUNCTION trapper.resolve_pending_trapper_link(
  p_pending_id UUID,
  p_person_id UUID,
  p_action TEXT,  -- 'link', 'create', 'dismiss'
  p_resolved_by TEXT,
  p_notes TEXT DEFAULT NULL
) RETURNS JSONB AS $$
DECLARE
  v_pending RECORD;
  v_link_id UUID;
  v_status TEXT;
BEGIN
  -- Get the pending record
  SELECT * INTO v_pending
  FROM trapper.pending_trapper_links
  WHERE pending_id = p_pending_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Pending record not found');
  END IF;

  IF v_pending.status != 'pending' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Already resolved');
  END IF;

  -- Determine status based on action
  CASE p_action
    WHEN 'link' THEN v_status := 'linked';
    WHEN 'create' THEN v_status := 'created';
    WHEN 'dismiss' THEN v_status := 'dismissed';
    ELSE
      RETURN jsonb_build_object('success', false, 'error', 'Invalid action: ' || p_action);
  END CASE;

  -- For link/create, create the external link and assign trapper role
  IF p_action IN ('link', 'create') THEN
    IF p_person_id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'person_id required for link/create');
    END IF;

    -- Create authoritative external link
    v_link_id := trapper.link_external_record_to_person(
      'airtable',
      'trappers',
      v_pending.airtable_record_id,
      p_person_id,
      'manual',
      p_resolved_by,
      'Resolved from pending queue: ' || COALESCE(p_notes, '')
    );

    -- Assign trapper role
    INSERT INTO trapper.person_roles (
      person_id, role, trapper_type, role_status, source_system, notes
    ) VALUES (
      p_person_id,
      'trapper',
      COALESCE(v_pending.trapper_type, 'community_trapper'),
      'active',
      'airtable',
      'Linked via admin UI by ' || p_resolved_by
    )
    ON CONFLICT (person_id, role)
    DO UPDATE SET
      trapper_type = COALESCE(EXCLUDED.trapper_type, trapper.person_roles.trapper_type),
      role_status = 'active',
      updated_at = NOW();
  END IF;

  -- Update pending record
  UPDATE trapper.pending_trapper_links
  SET status = v_status,
      resolved_person_id = p_person_id,
      resolved_at = NOW(),
      resolved_by = p_resolved_by,
      resolution_notes = p_notes,
      updated_at = NOW()
  WHERE pending_id = p_pending_id;

  RETURN jsonb_build_object(
    'success', true,
    'status', v_status,
    'person_id', p_person_id,
    'link_id', v_link_id
  );
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.resolve_pending_trapper_link IS
'Resolve a pending trapper link by linking to existing person, creating new, or dismissing.
Creates external_person_link and assigns trapper role when linking.';

-- ============================================================================
-- PART 4: View for pending queue (admin UI)
-- ============================================================================

\echo 'Creating v_pending_trapper_links view...'

CREATE OR REPLACE VIEW trapper.v_pending_trapper_links AS
SELECT
  ptl.pending_id,
  ptl.airtable_record_id,
  ptl.display_name,
  ptl.email,
  ptl.phone,
  ptl.address,
  ptl.trapper_type,
  ptl.failure_reason,
  ptl.candidate_person_ids,
  ptl.candidate_scores,
  ptl.status,
  ptl.created_at,
  -- Include candidate names for display
  (
    SELECT jsonb_agg(jsonb_build_object(
      'person_id', p.person_id,
      'display_name', p.display_name
    ))
    FROM trapper.sot_people p
    WHERE p.person_id = ANY(ptl.candidate_person_ids)
      AND p.merged_into_person_id IS NULL
  ) as candidate_details
FROM trapper.pending_trapper_links ptl
WHERE ptl.status = 'pending'
ORDER BY ptl.created_at DESC;

COMMENT ON VIEW trapper.v_pending_trapper_links IS
'Pending trapper links for admin review with candidate person details.';

-- ============================================================================
-- PART 5: Stats view
-- ============================================================================

\echo 'Creating v_pending_trapper_stats view...'

CREATE OR REPLACE VIEW trapper.v_pending_trapper_stats AS
SELECT
  status,
  COUNT(*) as count,
  MIN(created_at) as oldest,
  MAX(created_at) as newest
FROM trapper.pending_trapper_links
GROUP BY status
ORDER BY status;

COMMIT;

-- ============================================================================
-- VERIFICATION
-- ============================================================================

\echo ''
\echo 'Verifying table and functions created...'

SELECT
  'pending_trapper_links' as object,
  'table' as type,
  EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'trapper' AND table_name = 'pending_trapper_links'
  ) as exists;

SELECT
  proname as function_name
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = 'trapper'
  AND p.proname IN ('queue_pending_trapper_link', 'resolve_pending_trapper_link');

\echo ''
\echo '=============================================='
\echo 'MIG_558 Complete!'
\echo '=============================================='
\echo ''
\echo 'Created:'
\echo '  - trapper.pending_trapper_links table'
\echo '  - queue_pending_trapper_link() - add to queue'
\echo '  - resolve_pending_trapper_link() - resolve with link/create/dismiss'
\echo '  - v_pending_trapper_links view - for admin UI'
\echo '  - v_pending_trapper_stats view - queue statistics'
\echo ''
