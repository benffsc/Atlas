\echo ''
\echo '=============================================='
\echo 'MIG_538: Request Resolution Reasons'
\echo '=============================================='
\echo ''
\echo 'Adds resolution_reason column to sot_requests and creates'
\echo 'lookup table for standardized completion reasons.'
\echo ''

-- ============================================================================
-- PART 1: Create resolution reasons lookup table
-- ============================================================================

\echo 'Creating request_resolution_reasons lookup table...'

CREATE TABLE IF NOT EXISTS trapper.request_resolution_reasons (
  reason_code TEXT PRIMARY KEY,
  reason_label TEXT NOT NULL,
  reason_description TEXT,
  applies_to_status TEXT[] DEFAULT ARRAY['completed', 'cancelled'],
  requires_notes BOOLEAN DEFAULT FALSE,
  display_order INT DEFAULT 100,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE trapper.request_resolution_reasons IS
'Lookup table for standardized request completion/cancellation reasons';

-- Insert standard reasons
INSERT INTO trapper.request_resolution_reasons (reason_code, reason_label, reason_description, applies_to_status, requires_notes, display_order)
VALUES
  -- Completion reasons
  ('tnr_complete_all', 'TNR completed - all cats fixed', 'All known cats at the location have been trapped and altered', ARRAY['completed'], FALSE, 10),
  ('tnr_complete_partial', 'TNR completed - partial (some remain)', 'Some cats were fixed but others remain unfixed', ARRAY['completed'], FALSE, 20),
  ('cats_relocated', 'Cats relocated/removed', 'Cats were relocated to another location or removed', ARRAY['completed'], FALSE, 30),
  ('no_cats_found', 'No cats found at location', 'Site visits confirmed no cats present', ARRAY['completed'], FALSE, 40),
  ('requester_satisfied', 'Requester satisfied with outcome', 'Requester indicated they are satisfied and request can close', ARRAY['completed'], FALSE, 50),

  -- Cancellation/unable reasons
  ('requester_withdrew', 'Requester withdrew/cancelled', 'Requester asked to cancel the request', ARRAY['completed', 'cancelled'], FALSE, 60),
  ('unable_trap_shy', 'Unable to trap - cats too shy', 'Multiple attempts but cats avoid traps', ARRAY['completed', 'cancelled'], FALSE, 70),
  ('unable_access', 'Unable to access property', 'Could not get access to trap at location', ARRAY['completed', 'cancelled'], FALSE, 80),
  ('referred_out', 'Referred to another organization', 'Request referred to partner org or other resource', ARRAY['completed', 'cancelled'], FALSE, 90),
  ('duplicate_merged', 'Duplicate request - merged', 'Request was duplicate and merged with another', ARRAY['cancelled'], FALSE, 100),
  ('out_of_service_area', 'Outside service area', 'Location is outside FFSC service area', ARRAY['cancelled'], FALSE, 110),
  ('no_response', 'No response from requester', 'Multiple contact attempts with no response', ARRAY['cancelled'], FALSE, 120),

  -- Other
  ('other', 'Other (see notes)', 'Other reason - requires explanation in notes', ARRAY['completed', 'cancelled'], TRUE, 999)
ON CONFLICT (reason_code) DO UPDATE
SET reason_label = EXCLUDED.reason_label,
    reason_description = EXCLUDED.reason_description,
    applies_to_status = EXCLUDED.applies_to_status,
    requires_notes = EXCLUDED.requires_notes,
    display_order = EXCLUDED.display_order;

-- ============================================================================
-- PART 2: Add resolution_reason column to sot_requests
-- ============================================================================

\echo 'Adding resolution_reason column to sot_requests...'

ALTER TABLE trapper.sot_requests
ADD COLUMN IF NOT EXISTS resolution_reason TEXT;

COMMENT ON COLUMN trapper.sot_requests.resolution_reason IS
'Standardized reason code for why the request was completed or cancelled (FK to request_resolution_reasons)';

-- Add foreign key constraint (soft - allows NULL and values not in table for flexibility)
-- We don't enforce strict FK to allow custom reasons if needed

-- ============================================================================
-- PART 3: Create view for active reasons
-- ============================================================================

\echo 'Creating v_resolution_reasons view...'

CREATE OR REPLACE VIEW trapper.v_resolution_reasons AS
SELECT
  reason_code,
  reason_label,
  reason_description,
  applies_to_status,
  requires_notes,
  display_order
FROM trapper.request_resolution_reasons
WHERE is_active = TRUE
ORDER BY display_order;

COMMENT ON VIEW trapper.v_resolution_reasons IS
'Active resolution reasons ordered by display_order for UI dropdowns';

-- ============================================================================
-- SUMMARY
-- ============================================================================

\echo ''
\echo '=============================================='
\echo 'MIG_538 Complete!'
\echo '=============================================='
\echo ''
\echo 'Created:'
\echo '  - request_resolution_reasons lookup table with 13 standard reasons'
\echo '  - sot_requests.resolution_reason column'
\echo '  - v_resolution_reasons view for UI'
\echo ''
\echo 'Reasons include:'
\echo '  - TNR outcomes (complete all, partial, no cats found)'
\echo '  - Cancellation reasons (withdrew, unable, referred, duplicate)'
\echo '  - Other with required notes'
\echo ''
