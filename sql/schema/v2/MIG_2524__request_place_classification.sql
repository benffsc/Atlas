-- MIG_2524: Request Place Classification
--
-- Problem: When a request is created, we can infer place context:
-- - Trapper reporting = likely a colony site
-- - Request has kittens = likely a breeding site
-- - Multiple requests at same place = established colony
--
-- Solution:
-- 1. Auto-classify place context on request creation
-- 2. Track request-derived place contexts separately
-- 3. Use requestor role to inform classification
--
-- Created: 2026-02-26

\echo ''
\echo '=============================================='
\echo '  MIG_2524: Request Place Classification'
\echo '=============================================='
\echo ''

-- ============================================================================
-- 1. Pre-check: Current place context state
-- ============================================================================

\echo '1. Pre-check: Current place_contexts...'

SELECT
  context_type,
  COUNT(*) as count
FROM sot.place_contexts
GROUP BY context_type
ORDER BY count DESC;

-- ============================================================================
-- 2. Create place classification trigger function
-- ============================================================================

\echo ''
\echo '2. Creating classify_request_place() trigger function...'

CREATE OR REPLACE FUNCTION ops.classify_request_place()
RETURNS TRIGGER AS $$
DECLARE
  v_requestor_role TEXT;
  v_request_count INT;
BEGIN
  -- Skip if no place
  IF NEW.place_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Get requestor role
  v_requestor_role := COALESCE(
    NEW.requester_role_at_submission,
    ops.classify_requestor_role(NEW.requester_person_id)
  );

  -- Count existing requests at this place
  SELECT COUNT(*) INTO v_request_count
  FROM ops.requests
  WHERE place_id = NEW.place_id
    AND request_id != NEW.request_id;

  -- =========================================================================
  -- RULE 1: Trapper-reported location = likely colony site
  -- =========================================================================
  IF v_requestor_role IN ('ffsc_trapper', 'community_trapper', 'trapper', 'head_trapper') THEN
    -- Assign colony_site context if not already present
    PERFORM sot.assign_place_context(
      NEW.place_id,
      'colony_site',
      'inferred',
      'request_from_trapper',
      jsonb_build_object(
        'request_id', NEW.request_id,
        'trapper_role', v_requestor_role,
        'assigned_by', 'MIG_2524'
      )
    );
  END IF;

  -- =========================================================================
  -- RULE 2: Request with kittens = breeding site
  -- =========================================================================
  IF NEW.has_kittens = TRUE OR NEW.kitten_count > 0 THEN
    PERFORM sot.assign_place_context(
      NEW.place_id,
      'breeding_site',
      'inferred',
      'request_has_kittens',
      jsonb_build_object(
        'request_id', NEW.request_id,
        'kitten_count', COALESCE(NEW.kitten_count, 0),
        'assigned_by', 'MIG_2524'
      )
    );
  END IF;

  -- =========================================================================
  -- RULE 3: Multiple requests at same place = established colony
  -- (Only if this is the 3rd+ request)
  -- =========================================================================
  IF v_request_count >= 2 THEN
    PERFORM sot.assign_place_context(
      NEW.place_id,
      'established_colony',
      'inferred',
      'multiple_requests',
      jsonb_build_object(
        'request_count', v_request_count + 1,
        'assigned_by', 'MIG_2524'
      )
    );
  END IF;

  -- =========================================================================
  -- RULE 4: High urgency request = urgent_site context
  -- =========================================================================
  IF NEW.priority IN ('urgent', 'emergency') OR NEW.urgency_score >= 8 THEN
    PERFORM sot.assign_place_context(
      NEW.place_id,
      'urgent_site',
      'inferred',
      'high_priority_request',
      jsonb_build_object(
        'request_id', NEW.request_id,
        'priority', NEW.priority,
        'urgency_score', NEW.urgency_score,
        'assigned_by', 'MIG_2524'
      )
    );
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop existing trigger if any
DROP TRIGGER IF EXISTS trg_classify_request_place ON ops.requests;

-- Create trigger (AFTER INSERT so requester_role_at_submission is set)
CREATE TRIGGER trg_classify_request_place
AFTER INSERT ON ops.requests
FOR EACH ROW EXECUTE FUNCTION ops.classify_request_place();

\echo '   Created trigger trg_classify_request_place'

-- ============================================================================
-- 3. Ensure place_context_types exist
-- ============================================================================

\echo ''
\echo '3. Ensuring place_context_types exist...'

INSERT INTO sot.place_context_types (context_type, description, color)
VALUES
  ('colony_site', 'Known or suspected feral cat colony location', '#f59e0b'),
  ('breeding_site', 'Location where kittens have been reported', '#ec4899'),
  ('established_colony', 'Colony with multiple requests/visits over time', '#8b5cf6'),
  ('urgent_site', 'High priority location requiring immediate attention', '#ef4444')
ON CONFLICT (context_type) DO UPDATE
SET description = EXCLUDED.description,
    color = EXCLUDED.color;

-- ============================================================================
-- 4. Backfill existing requests
-- ============================================================================

\echo ''
\echo '4. Backfilling place contexts from existing requests...'

-- Trapper-reported colonies
WITH trapper_requests AS (
  SELECT DISTINCT r.place_id, r.request_id, r.requester_role_at_submission
  FROM ops.requests r
  WHERE r.place_id IS NOT NULL
    AND r.requester_role_at_submission IN ('ffsc_trapper', 'community_trapper', 'trapper', 'head_trapper')
)
INSERT INTO sot.place_contexts (place_id, context_type, evidence_type, source_description, metadata)
SELECT
  tr.place_id,
  'colony_site',
  'inferred',
  'backfill_trapper_requests',
  jsonb_build_object('request_id', tr.request_id, 'trapper_role', tr.requester_role_at_submission, 'assigned_by', 'MIG_2524_backfill')
FROM trapper_requests tr
ON CONFLICT (place_id, context_type) DO NOTHING;

-- Kitten sites
WITH kitten_requests AS (
  SELECT DISTINCT r.place_id, r.request_id, r.kitten_count
  FROM ops.requests r
  WHERE r.place_id IS NOT NULL
    AND (r.has_kittens = TRUE OR r.kitten_count > 0)
)
INSERT INTO sot.place_contexts (place_id, context_type, evidence_type, source_description, metadata)
SELECT
  kr.place_id,
  'breeding_site',
  'inferred',
  'backfill_kitten_requests',
  jsonb_build_object('request_id', kr.request_id, 'kitten_count', COALESCE(kr.kitten_count, 0), 'assigned_by', 'MIG_2524_backfill')
FROM kitten_requests kr
ON CONFLICT (place_id, context_type) DO NOTHING;

-- Multi-request places (established colonies)
WITH multi_request_places AS (
  SELECT place_id, COUNT(*) as request_count
  FROM ops.requests
  WHERE place_id IS NOT NULL
  GROUP BY place_id
  HAVING COUNT(*) >= 3
)
INSERT INTO sot.place_contexts (place_id, context_type, evidence_type, source_description, metadata)
SELECT
  mrp.place_id,
  'established_colony',
  'inferred',
  'backfill_multi_requests',
  jsonb_build_object('request_count', mrp.request_count, 'assigned_by', 'MIG_2524_backfill')
FROM multi_request_places mrp
ON CONFLICT (place_id, context_type) DO NOTHING;

-- High priority sites
WITH urgent_requests AS (
  SELECT DISTINCT r.place_id, r.request_id, r.priority, r.urgency_score
  FROM ops.requests r
  WHERE r.place_id IS NOT NULL
    AND (r.priority IN ('urgent', 'emergency') OR r.urgency_score >= 8)
)
INSERT INTO sot.place_contexts (place_id, context_type, evidence_type, source_description, metadata)
SELECT
  ur.place_id,
  'urgent_site',
  'inferred',
  'backfill_urgent_requests',
  jsonb_build_object('request_id', ur.request_id, 'priority', ur.priority, 'urgency_score', ur.urgency_score, 'assigned_by', 'MIG_2524_backfill')
FROM urgent_requests ur
ON CONFLICT (place_id, context_type) DO NOTHING;

-- ============================================================================
-- 5. Post-check
-- ============================================================================

\echo ''
\echo '5. Post-check: Place context counts...'

SELECT
  context_type,
  evidence_type,
  COUNT(*) as count
FROM sot.place_contexts
WHERE source_description LIKE '%request%' OR source_description LIKE '%MIG_2524%'
GROUP BY context_type, evidence_type
ORDER BY count DESC;

\echo ''
\echo '=============================================='
\echo '  MIG_2524 Complete'
\echo '=============================================='
\echo ''
\echo 'Created: classify_request_place() trigger function'
\echo 'Added: place_context_types (colony_site, breeding_site, established_colony, urgent_site)'
\echo 'Backfilled: Place contexts from existing requests'
\echo ''
\echo 'Auto-classification rules:'
\echo '  - Trapper-reported = colony_site'
\echo '  - Has kittens = breeding_site'
\echo '  - 3+ requests = established_colony'
\echo '  - High priority = urgent_site'
\echo ''
