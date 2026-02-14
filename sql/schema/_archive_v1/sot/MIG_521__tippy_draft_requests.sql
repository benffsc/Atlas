-- MIG_521: Tippy Draft Requests
--
-- Purpose: Allow Tippy to create "draft" requests that require staff approval
-- before becoming official requests in sot_requests.
--
-- Key Design:
--   - Drafts are stored separately from sot_requests
--   - Staff review queue shows pending drafts with place context
--   - Approval promotes draft to real request via find_or_create_request()
--   - Drafts expire after 7 days if not reviewed

\echo ''
\echo '=============================================='
\echo 'MIG_521: Tippy Draft Requests'
\echo '=============================================='
\echo ''

-- 1. Create draft requests table
\echo 'Creating tippy_draft_requests table...'

CREATE TABLE IF NOT EXISTS trapper.tippy_draft_requests (
  draft_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Conversation context
  conversation_id UUID REFERENCES trapper.tippy_conversations(conversation_id),
  created_by_staff_id UUID NOT NULL REFERENCES trapper.staff(staff_id),

  -- Request data (mirrors key sot_requests fields)
  raw_address TEXT NOT NULL,
  place_id UUID REFERENCES trapper.places(place_id),  -- Resolved during creation
  requester_name TEXT,
  requester_phone TEXT,
  requester_email TEXT,
  estimated_cat_count INT,
  summary TEXT,
  notes TEXT,
  has_kittens BOOLEAN DEFAULT FALSE,
  priority TEXT DEFAULT 'normal' CHECK (priority IN ('urgent', 'high', 'normal', 'low')),

  -- Tippy context
  tippy_reasoning TEXT,  -- Why Tippy thinks this request should be created
  place_context JSONB,   -- Existing TNR history at place (for reviewer)

  -- Review workflow
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'expired')),
  reviewed_by UUID REFERENCES trapper.staff(staff_id),
  reviewed_at TIMESTAMPTZ,
  review_notes TEXT,

  -- If approved, link to created request
  promoted_request_id UUID REFERENCES trapper.sot_requests(request_id),

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ DEFAULT NOW() + INTERVAL '7 days',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_tippy_drafts_status ON trapper.tippy_draft_requests(status);
CREATE INDEX IF NOT EXISTS idx_tippy_drafts_created_by ON trapper.tippy_draft_requests(created_by_staff_id);
CREATE INDEX IF NOT EXISTS idx_tippy_drafts_expires ON trapper.tippy_draft_requests(expires_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_tippy_drafts_place ON trapper.tippy_draft_requests(place_id) WHERE place_id IS NOT NULL;

COMMENT ON TABLE trapper.tippy_draft_requests IS
'Draft requests created by Tippy AI that require staff approval before becoming official.
Drafts expire after 7 days if not reviewed.';

\echo 'Draft requests table created.'

-- 2. Create approval function
\echo 'Creating approve_tippy_draft function...'

CREATE OR REPLACE FUNCTION trapper.approve_tippy_draft(
  p_draft_id UUID,
  p_approved_by UUID,
  p_review_notes TEXT DEFAULT NULL,
  -- Allow overrides during approval
  p_override_address TEXT DEFAULT NULL,
  p_override_cat_count INT DEFAULT NULL,
  p_override_priority TEXT DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
  v_draft RECORD;
  v_request_id UUID;
BEGIN
  -- Get and lock draft
  SELECT * INTO v_draft
  FROM trapper.tippy_draft_requests
  WHERE draft_id = p_draft_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Draft % not found', p_draft_id;
  END IF;

  IF v_draft.status != 'pending' THEN
    RAISE EXCEPTION 'Draft % is not pending (status: %)', p_draft_id, v_draft.status;
  END IF;

  IF v_draft.expires_at < NOW() THEN
    -- Mark as expired and fail
    UPDATE trapper.tippy_draft_requests
    SET status = 'expired', updated_at = NOW()
    WHERE draft_id = p_draft_id;
    RAISE EXCEPTION 'Draft % has expired', p_draft_id;
  END IF;

  -- Create actual request via find_or_create_request
  v_request_id := trapper.find_or_create_request(
    p_source_system := 'atlas_ui',
    p_source_record_id := 'tippy_draft_' || p_draft_id::TEXT,
    p_source_created_at := v_draft.created_at,
    p_place_id := v_draft.place_id,
    p_raw_address := COALESCE(p_override_address, v_draft.raw_address),
    p_requester_email := v_draft.requester_email,
    p_requester_phone := v_draft.requester_phone,
    p_requester_name := v_draft.requester_name,
    p_summary := v_draft.summary,
    p_notes := 'Created from Tippy draft. ' || COALESCE(v_draft.notes, '') ||
               CASE WHEN v_draft.tippy_reasoning IS NOT NULL
                    THEN E'\n\nTippy reasoning: ' || v_draft.tippy_reasoning
                    ELSE '' END,
    p_estimated_cat_count := COALESCE(p_override_cat_count, v_draft.estimated_cat_count),
    p_has_kittens := v_draft.has_kittens,
    p_priority := COALESCE(p_override_priority, v_draft.priority),
    p_created_by := 'tippy_approved_by_' || p_approved_by::TEXT
  );

  -- Update draft status
  UPDATE trapper.tippy_draft_requests
  SET
    status = 'approved',
    reviewed_by = p_approved_by,
    reviewed_at = NOW(),
    review_notes = p_review_notes,
    promoted_request_id = v_request_id,
    updated_at = NOW()
  WHERE draft_id = p_draft_id;

  RETURN v_request_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.approve_tippy_draft IS
'Approves a Tippy draft request and promotes it to an official sot_requests record.
Accepts optional overrides for address, cat count, and priority.
Returns the new request_id.';

-- 3. Create rejection function
\echo 'Creating reject_tippy_draft function...'

CREATE OR REPLACE FUNCTION trapper.reject_tippy_draft(
  p_draft_id UUID,
  p_rejected_by UUID,
  p_review_notes TEXT DEFAULT NULL
)
RETURNS VOID AS $$
BEGIN
  UPDATE trapper.tippy_draft_requests
  SET
    status = 'rejected',
    reviewed_by = p_rejected_by,
    reviewed_at = NOW(),
    review_notes = p_review_notes,
    updated_at = NOW()
  WHERE draft_id = p_draft_id
    AND status = 'pending';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Draft % not found or not pending', p_draft_id;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- 4. Create review queue view
\echo 'Creating v_tippy_draft_review_queue view...'

CREATE OR REPLACE VIEW trapper.v_tippy_draft_review_queue AS
SELECT
  d.draft_id,
  d.created_at,
  d.expires_at,
  d.expires_at < NOW() AS is_expired,
  EXTRACT(EPOCH FROM (d.expires_at - NOW())) / 3600 AS hours_until_expiry,

  -- Draft details
  d.raw_address,
  d.requester_name,
  d.requester_phone,
  d.requester_email,
  d.estimated_cat_count,
  d.summary,
  d.notes,
  d.has_kittens,
  d.priority,
  d.tippy_reasoning,

  -- Place context
  d.place_id,
  p.display_name AS place_name,
  p.formatted_address AS place_address,
  d.place_context,

  -- Existing place stats (if place exists)
  (SELECT COUNT(*) FROM trapper.sot_requests r
   WHERE r.place_id = d.place_id
   AND r.status NOT IN ('cancelled', 'redirected')) AS existing_request_count,
  (SELECT COUNT(*) FROM trapper.sot_requests r
   WHERE r.place_id = d.place_id
   AND r.status NOT IN ('completed', 'cancelled', 'redirected', 'partial')) AS active_request_count,
  (SELECT SUM(vas.cats_altered) FROM trapper.v_request_alteration_stats vas
   JOIN trapper.sot_requests r ON r.request_id = vas.request_id
   WHERE r.place_id = d.place_id) AS cats_already_altered,

  -- Creator info
  d.created_by_staff_id,
  s.display_name AS created_by_name,
  d.conversation_id

FROM trapper.tippy_draft_requests d
LEFT JOIN trapper.places p ON p.place_id = d.place_id
LEFT JOIN trapper.staff s ON s.staff_id = d.created_by_staff_id
WHERE d.status = 'pending'
ORDER BY
  -- Urgent first, then by expiration
  CASE WHEN d.priority = 'urgent' THEN 0 ELSE 1 END,
  d.expires_at ASC;

COMMENT ON VIEW trapper.v_tippy_draft_review_queue IS
'Pending Tippy draft requests awaiting staff review.
Shows place context including existing requests and TNR history.
Ordered by priority and expiration time.';

-- 5. Create stats view
\echo 'Creating v_tippy_draft_stats view...'

CREATE OR REPLACE VIEW trapper.v_tippy_draft_stats AS
SELECT
  COUNT(*) FILTER (WHERE status = 'pending') AS pending_count,
  COUNT(*) FILTER (WHERE status = 'approved') AS approved_count,
  COUNT(*) FILTER (WHERE status = 'rejected') AS rejected_count,
  COUNT(*) FILTER (WHERE status = 'expired') AS expired_count,
  COUNT(*) FILTER (WHERE status = 'approved' AND reviewed_at > NOW() - INTERVAL '7 days') AS approved_this_week,
  COUNT(*) FILTER (WHERE status = 'rejected' AND reviewed_at > NOW() - INTERVAL '7 days') AS rejected_this_week,
  ROUND(
    100.0 * COUNT(*) FILTER (WHERE status = 'approved') /
    NULLIF(COUNT(*) FILTER (WHERE status IN ('approved', 'rejected')), 0),
    1
  ) AS approval_rate_pct,
  AVG(EXTRACT(EPOCH FROM (reviewed_at - created_at)) / 3600)
    FILTER (WHERE status IN ('approved', 'rejected')) AS avg_review_hours
FROM trapper.tippy_draft_requests;

-- 6. Auto-expire job (can be called by cron)
\echo 'Creating expire_old_drafts function...'

CREATE OR REPLACE FUNCTION trapper.expire_old_drafts()
RETURNS INT AS $$
DECLARE
  v_count INT;
BEGIN
  UPDATE trapper.tippy_draft_requests
  SET status = 'expired', updated_at = NOW()
  WHERE status = 'pending' AND expires_at < NOW();

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.expire_old_drafts IS
'Expires all pending drafts that have passed their expiration date.
Call this periodically (e.g., daily cron) to clean up old drafts.
Returns the number of drafts expired.';

\echo ''
\echo '=============================================='
\echo 'MIG_521 Complete!'
\echo '=============================================='
\echo ''
\echo 'Created:'
\echo '  - tippy_draft_requests table'
\echo '  - approve_tippy_draft() function'
\echo '  - reject_tippy_draft() function'
\echo '  - v_tippy_draft_review_queue view'
\echo '  - v_tippy_draft_stats view'
\echo '  - expire_old_drafts() function'
\echo ''
\echo 'Workflow:'
\echo '  1. Tippy creates draft via INSERT to tippy_draft_requests'
\echo '  2. Staff reviews in /admin/tippy-drafts'
\echo '  3. Staff approves (creates request) or rejects'
\echo '  4. Unapproved drafts expire after 7 days'
\echo ''
