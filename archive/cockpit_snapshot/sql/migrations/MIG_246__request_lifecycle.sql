-- MIG_246__request_lifecycle.sql
-- MEGA_003: Request lifecycle layer - "Closed ≠ Closed"
--
-- Core principle: Airtable Status stays untouched; Cockpit adds nuanced outcomes
-- - outcome + closure_reason provide "why closed?" context
-- - request_links enable "continued_in" / "duplicate_of" relationships
-- - No destructive ops; additive only
--
-- SAFE: Additive only, no destructive operations

-- ============================================================
-- PART 1: Request Outcomes (lookup table, not enum)
-- ============================================================

CREATE TABLE IF NOT EXISTS trapper.request_outcomes (
    code TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    description TEXT,
    is_terminal BOOLEAN DEFAULT FALSE,  -- true = request is "done"
    sort_order SMALLINT DEFAULT 50,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE trapper.request_outcomes IS
'Lookup table for request outcomes. Prefer lookup over enum for flexibility.';

-- Seed initial outcomes
INSERT INTO trapper.request_outcomes (code, display_name, description, is_terminal, sort_order) VALUES
    ('open', 'Open', 'Request is active and needs attention', FALSE, 10),
    ('paused', 'Paused', 'Temporarily on hold (e.g., waiting for callback)', FALSE, 20),
    ('resolved', 'Resolved', 'All cats altered, colony stabilized', TRUE, 30),
    ('dead_end', 'Dead End', 'Cannot proceed (no access, no response, etc.)', TRUE, 40),
    ('superseded', 'Superseded', 'Continued in another request or merged', TRUE, 50)
ON CONFLICT (code) DO NOTHING;

-- ============================================================
-- PART 2: Closure Reasons (lookup table)
-- ============================================================

CREATE TABLE IF NOT EXISTS trapper.closure_reasons (
    code TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    description TEXT,
    applies_to_outcomes TEXT[],  -- which outcomes this reason can be used with
    sort_order SMALLINT DEFAULT 50,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE trapper.closure_reasons IS
'Lookup table for closure reasons. Ben asked: "why closed?" - this captures nuance.';

-- Seed initial closure reasons
INSERT INTO trapper.closure_reasons (code, display_name, description, applies_to_outcomes, sort_order) VALUES
    ('went_cold_no_response', 'No Response', 'Client stopped responding after multiple attempts', ARRAY['dead_end', 'paused'], 10),
    ('no_cats_seen_anymore', 'No Cats Seen', 'Cats no longer observed at location', ARRAY['resolved', 'dead_end'], 15),
    ('continued_in_other_request', 'Continued Elsewhere', 'Work continues in a linked request', ARRAY['superseded'], 20),
    ('duplicate_intake', 'Duplicate Intake', 'Same request submitted multiple times', ARRAY['superseded'], 25),
    ('clutter_cleanup_admin', 'Admin Cleanup', 'Request was data clutter (test, incomplete, etc.)', ARRAY['dead_end'], 30),
    ('access_denied', 'Access Denied', 'Property owner or manager denied access', ARRAY['dead_end'], 35),
    ('cat_moved_address_changed', 'Cats Relocated', 'Cats moved or client moved away', ARRAY['dead_end', 'resolved'], 40),
    ('trapped_by_other_party', 'Trapped by Others', 'Another organization or individual handled TNR', ARRAY['resolved'], 45),
    ('resolved_all_cats_altered', 'All Cats Altered', 'Colony fully altered and stabilized', ARRAY['resolved'], 50),
    ('owner_surrender', 'Owner Surrender', 'Client surrendered cats to shelter/rescue', ARRAY['resolved'], 55),
    ('other', 'Other', 'See notes for details', ARRAY['resolved', 'dead_end', 'superseded', 'paused'], 99)
ON CONFLICT (code) DO NOTHING;

-- ============================================================
-- PART 3: Add lifecycle columns to requests
-- ============================================================

-- Add outcome and closure_reason to requests table
ALTER TABLE trapper.requests
ADD COLUMN IF NOT EXISTS outcome TEXT REFERENCES trapper.request_outcomes(code),
ADD COLUMN IF NOT EXISTS closure_reason TEXT REFERENCES trapper.closure_reasons(code),
ADD COLUMN IF NOT EXISTS outcome_notes TEXT,
ADD COLUMN IF NOT EXISTS outcome_set_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS outcome_set_by TEXT;

COMMENT ON COLUMN trapper.requests.outcome IS 'Cockpit-managed outcome (open/paused/resolved/dead_end/superseded). Separate from Airtable status.';
COMMENT ON COLUMN trapper.requests.closure_reason IS 'Why the request was closed/resolved. Provides nuance beyond just "closed".';
COMMENT ON COLUMN trapper.requests.outcome_notes IS 'Free-text notes explaining the outcome decision.';

-- Index for filtering by outcome
CREATE INDEX IF NOT EXISTS idx_requests_outcome
ON trapper.requests(outcome) WHERE outcome IS NOT NULL;

-- ============================================================
-- PART 4: Request Links (relationships between requests)
-- ============================================================

CREATE TABLE IF NOT EXISTS trapper.request_links (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Source request (the one being linked FROM)
    source_request_id UUID NOT NULL REFERENCES trapper.requests(id) ON DELETE CASCADE,

    -- Target request (the one being linked TO)
    target_request_id UUID NOT NULL REFERENCES trapper.requests(id) ON DELETE CASCADE,

    -- Link type
    link_type TEXT NOT NULL CHECK (link_type IN (
        'duplicate_of',     -- source is a duplicate of target
        'continued_in',     -- work from source continues in target
        'followup_of',      -- source is a followup to target
        'split_into',       -- source was split, part went to target
        'merged_into',      -- source was merged into target
        'reopened_from',    -- source was reopened from closed target
        'related_to'        -- general relationship (same location, person, etc.)
    )),

    -- Confidence and reasoning
    confidence SMALLINT DEFAULT 100 CHECK (confidence >= 0 AND confidence <= 100),
    link_method TEXT CHECK (link_method IN (
        'manual',           -- Staff created the link
        'auto_detected',    -- System suggested, staff confirmed
        'system_inferred'   -- System created automatically
    )) DEFAULT 'manual',

    -- Audit
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by TEXT DEFAULT 'system',

    -- Prevent duplicate links
    CONSTRAINT unique_request_link UNIQUE (source_request_id, target_request_id, link_type),

    -- Prevent self-links
    CONSTRAINT no_self_link CHECK (source_request_id != target_request_id)
);

COMMENT ON TABLE trapper.request_links IS
'Links between requests (duplicate_of, continued_in, etc.). Enables tracking without deleting.';

CREATE INDEX IF NOT EXISTS idx_request_links_source
ON trapper.request_links(source_request_id);

CREATE INDEX IF NOT EXISTS idx_request_links_target
ON trapper.request_links(target_request_id);

CREATE INDEX IF NOT EXISTS idx_request_links_type
ON trapper.request_links(link_type);

-- ============================================================
-- PART 5: View for request with lifecycle info
-- ============================================================

CREATE OR REPLACE VIEW trapper.v_requests_with_lifecycle AS
SELECT
    r.id,
    r.case_number,
    r.status,
    r.outcome,
    ro.display_name AS outcome_display,
    ro.is_terminal AS is_closed,
    r.closure_reason,
    cr.display_name AS closure_reason_display,
    r.outcome_notes,
    r.outcome_set_at,
    r.outcome_set_by,
    r.request_kind,
    r.primary_place_id,
    r.primary_contact_person_id,
    r.created_at,
    r.updated_at,
    -- Count related requests
    (SELECT COUNT(*) FROM trapper.request_links rl
     WHERE rl.source_request_id = r.id OR rl.target_request_id = r.id) AS related_request_count
FROM trapper.requests r
LEFT JOIN trapper.request_outcomes ro ON r.outcome = ro.code
LEFT JOIN trapper.closure_reasons cr ON r.closure_reason = cr.code;

COMMENT ON VIEW trapper.v_requests_with_lifecycle IS
'Requests with lifecycle info (outcome, closure reason, related request count).';

-- ============================================================
-- PART 6: View for request links with display info
-- ============================================================

CREATE OR REPLACE VIEW trapper.v_request_links_display AS
SELECT
    rl.id AS link_id,
    rl.source_request_id,
    rs.case_number AS source_case_number,
    rl.target_request_id,
    rt.case_number AS target_case_number,
    rl.link_type,
    CASE rl.link_type
        WHEN 'duplicate_of' THEN 'Duplicate of'
        WHEN 'continued_in' THEN 'Continued in'
        WHEN 'followup_of' THEN 'Follow-up of'
        WHEN 'split_into' THEN 'Split into'
        WHEN 'merged_into' THEN 'Merged into'
        WHEN 'reopened_from' THEN 'Reopened from'
        WHEN 'related_to' THEN 'Related to'
        ELSE rl.link_type
    END AS link_type_display,
    rl.confidence,
    rl.link_method,
    rl.notes,
    rl.created_at,
    rl.created_by
FROM trapper.request_links rl
JOIN trapper.requests rs ON rl.source_request_id = rs.id
JOIN trapper.requests rt ON rl.target_request_id = rt.id;

COMMENT ON VIEW trapper.v_request_links_display IS
'Request links with case numbers and display-friendly link type names.';

-- ============================================================
-- PART 7: Helper function to link requests
-- ============================================================

CREATE OR REPLACE FUNCTION trapper.link_requests(
    p_source_request_id UUID,
    p_target_request_id UUID,
    p_link_type TEXT,
    p_notes TEXT DEFAULT NULL,
    p_created_by TEXT DEFAULT 'system'
) RETURNS UUID AS $$
DECLARE
    v_link_id UUID;
BEGIN
    -- Validate link type
    IF p_link_type NOT IN ('duplicate_of', 'continued_in', 'followup_of', 'split_into', 'merged_into', 'reopened_from', 'related_to') THEN
        RAISE EXCEPTION 'Invalid link type: %', p_link_type;
    END IF;

    -- Insert link (ON CONFLICT returns existing if duplicate)
    INSERT INTO trapper.request_links (
        source_request_id, target_request_id, link_type, notes, created_by
    ) VALUES (
        p_source_request_id, p_target_request_id, p_link_type, p_notes, p_created_by
    )
    ON CONFLICT (source_request_id, target_request_id, link_type) DO UPDATE
    SET notes = COALESCE(EXCLUDED.notes, trapper.request_links.notes)
    RETURNING id INTO v_link_id;

    -- If marking as duplicate_of or merged_into, auto-set outcome on source
    IF p_link_type IN ('duplicate_of', 'merged_into', 'continued_in') THEN
        UPDATE trapper.requests
        SET outcome = 'superseded',
            closure_reason = CASE p_link_type
                WHEN 'duplicate_of' THEN 'duplicate_intake'
                WHEN 'continued_in' THEN 'continued_in_other_request'
                ELSE NULL
            END,
            outcome_set_at = NOW(),
            outcome_set_by = p_created_by
        WHERE id = p_source_request_id
        AND outcome IS NULL;  -- Only if not already set
    END IF;

    RETURN v_link_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.link_requests IS
'Links two requests and optionally auto-sets outcome for duplicate/merged/continued links.';

-- ============================================================
-- PART 8: Helper function to set request outcome
-- ============================================================

CREATE OR REPLACE FUNCTION trapper.set_request_outcome(
    p_request_id UUID,
    p_outcome TEXT,
    p_closure_reason TEXT DEFAULT NULL,
    p_notes TEXT DEFAULT NULL,
    p_set_by TEXT DEFAULT 'system'
) RETURNS BOOLEAN AS $$
BEGIN
    -- Validate outcome exists
    IF NOT EXISTS (SELECT 1 FROM trapper.request_outcomes WHERE code = p_outcome AND is_active) THEN
        RAISE EXCEPTION 'Invalid or inactive outcome: %', p_outcome;
    END IF;

    -- Validate closure_reason if provided
    IF p_closure_reason IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM trapper.closure_reasons WHERE code = p_closure_reason AND is_active
    ) THEN
        RAISE EXCEPTION 'Invalid or inactive closure reason: %', p_closure_reason;
    END IF;

    -- Update request
    UPDATE trapper.requests
    SET outcome = p_outcome,
        closure_reason = p_closure_reason,
        outcome_notes = COALESCE(p_notes, outcome_notes),
        outcome_set_at = NOW(),
        outcome_set_by = p_set_by,
        updated_at = NOW()
    WHERE id = p_request_id;

    RETURN FOUND;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.set_request_outcome IS
'Sets outcome and closure reason on a request with validation.';

-- ============================================================
-- Verification
-- ============================================================

\echo ''
\echo 'MIG_246 applied. Request lifecycle schema created.'
\echo ''

\echo 'Lookup tables created:'
SELECT 'request_outcomes' AS table_name, COUNT(*) AS row_count FROM trapper.request_outcomes
UNION ALL
SELECT 'closure_reasons', COUNT(*) FROM trapper.closure_reasons;

\echo ''
\echo 'New columns added to requests:'
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'trapper'
AND table_name = 'requests'
AND column_name IN ('outcome', 'closure_reason', 'outcome_notes', 'outcome_set_at', 'outcome_set_by');

