-- MIG_2819: Add resolution_outcome to ops.requests
-- Separates "is this case active?" (status) from "what happened?" (resolution outcome)
-- Following Jira pattern: resolution is only set when status=completed, cleared on reopen
--
-- FFS-155: Unify request closure system with resolution outcomes

-- ============================================================================
-- 1. Add resolution_outcome column to ops.requests
-- ============================================================================
ALTER TABLE ops.requests ADD COLUMN IF NOT EXISTS resolution_outcome TEXT;

COMMENT ON COLUMN ops.requests.resolution_outcome IS
  'Why the case was closed: successful, partial, unable_to_complete, no_longer_needed, referred_out. Only set when status=completed.';

-- ============================================================================
-- 2. Add outcome_category to resolution_reasons table
-- ============================================================================
ALTER TABLE ops.request_resolution_reasons
  ADD COLUMN IF NOT EXISTS outcome_category TEXT;

COMMENT ON COLUMN ops.request_resolution_reasons.outcome_category IS
  'Links reason to an outcome: successful, partial, unable_to_complete, no_longer_needed, referred_out';

-- ============================================================================
-- 3. Backfill historical completed requests
-- ============================================================================

-- Completed requests with resolved_at → assume successful
UPDATE ops.requests SET resolution_outcome = 'successful'
  WHERE status = 'completed' AND resolution_outcome IS NULL
    AND resolved_at IS NOT NULL;

-- Cancelled requests → no_longer_needed
UPDATE ops.requests SET resolution_outcome = 'no_longer_needed'
  WHERE status = 'cancelled' AND resolution_outcome IS NULL;

-- Partial requests → partial
UPDATE ops.requests SET resolution_outcome = 'partial'
  WHERE status = 'partial' AND resolution_outcome IS NULL;

-- Redirected → referred_out
UPDATE ops.requests SET resolution_outcome = 'referred_out'
  WHERE status = 'redirected' AND resolution_outcome IS NULL;

-- ============================================================================
-- 4. Update existing resolution reasons with outcome_category
-- ============================================================================
UPDATE ops.request_resolution_reasons SET outcome_category = 'successful'
  WHERE reason_key = 'all_cats_fixed';

UPDATE ops.request_resolution_reasons SET outcome_category = 'successful'
  WHERE reason_key = 'colony_relocated';

UPDATE ops.request_resolution_reasons SET outcome_category = 'unable_to_complete'
  WHERE reason_key = 'no_cats_found';

UPDATE ops.request_resolution_reasons SET outcome_category = 'no_longer_needed'
  WHERE reason_key = 'requester_unresponsive';

UPDATE ops.request_resolution_reasons SET outcome_category = 'no_longer_needed'
  WHERE reason_key = 'duplicate_request';

UPDATE ops.request_resolution_reasons SET outcome_category = 'referred_out'
  WHERE reason_key = 'outside_service_area';

-- ============================================================================
-- 5. Insert new resolution reasons for all outcome categories
-- ============================================================================
INSERT INTO ops.request_resolution_reasons (reason_key, reason_label, applies_to_status, requires_notes, display_order, is_active, outcome_category)
VALUES
  -- Successful outcomes
  ('most_cats_fixed', 'Most cats fixed', '{completed}', false, 2, true, 'successful'),
  -- Partial outcomes
  ('trap_shy_remaining', 'Remaining cats are trap-shy', '{completed}', false, 10, true, 'partial'),
  ('access_lost', 'Lost access to property', '{completed}', false, 11, true, 'partial'),
  ('some_cats_relocated', 'Some cats relocated/disappeared', '{completed}', false, 12, true, 'partial'),
  -- Unable to complete
  ('cats_gone', 'Cats no longer present', '{completed}', false, 20, true, 'unable_to_complete'),
  ('access_revoked', 'Property access revoked', '{completed}', false, 21, true, 'unable_to_complete'),
  ('safety_concern', 'Safety concern at location', '{completed}', true, 22, true, 'unable_to_complete'),
  -- No longer needed
  ('requester_withdrew', 'Requester withdrew request', '{completed}', false, 30, true, 'no_longer_needed'),
  ('resolved_independently', 'Resolved independently', '{completed}', false, 31, true, 'no_longer_needed'),
  ('no_response', 'No response from requester', '{completed}', false, 32, true, 'no_longer_needed'),
  -- Referred out
  ('referred_to_org', 'Referred to another organization', '{completed}', false, 40, true, 'referred_out'),
  ('outside_area', 'Outside service area', '{completed}', false, 41, true, 'referred_out')
ON CONFLICT (reason_key) DO UPDATE SET
  outcome_category = EXCLUDED.outcome_category,
  display_order = EXCLUDED.display_order;

-- ============================================================================
-- 6. Create index for filtering by outcome
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_requests_resolution_outcome
  ON ops.requests (resolution_outcome) WHERE resolution_outcome IS NOT NULL;
