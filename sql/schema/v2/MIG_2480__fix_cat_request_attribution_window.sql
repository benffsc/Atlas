-- MIG_2480: Fix Cat-Request Attribution Window
--
-- PROBLEM: Current sot.link_cats_to_requests_safe() only links cats at places
-- of ACTIVE requests, missing attribution window logic entirely.
--
-- Current state: 383 links
-- Should have: 942 links (based on proper attribution)
-- Missing: 835 links (89% gap!)
--
-- ATTRIBUTION WINDOW RULES (from business requirements):
-- 1. BEFORE REQUEST (6 months): People often fix cats BEFORE requesting help
--    - Cat appointment 6 months before request creation counts
--    - Covers: "We've been fixing strays, now need trapper help"
--
-- 2. DURING REQUEST: Any cat fixed while request is open
--    - From request creation until resolution
--    - Standard active-request attribution
--
-- 3. GRACE PERIOD (3 months): Late arrivals after resolution
--    - Cats fixed up to 3 months after request closed
--    - Covers: Last few cats brought in after coordinator closed request
--
-- Created: 2026-02-23

\echo ''
\echo '=============================================='
\echo '  MIG_2480: Fix Cat-Request Attribution'
\echo '=============================================='
\echo ''

-- ============================================================================
-- 1. CREATE PROPER ATTRIBUTION WINDOW FUNCTION
-- ============================================================================

\echo '1. Creating sot.link_cats_to_requests_attribution()...'

CREATE OR REPLACE FUNCTION sot.link_cats_to_requests_attribution()
RETURNS TABLE(linked integer, skipped integer, before_request integer, during_request integer, grace_period integer)
LANGUAGE plpgsql
AS $function$
DECLARE
  v_linked INTEGER := 0;
  v_before INTEGER := 0;
  v_during INTEGER := 0;
  v_grace INTEGER := 0;
BEGIN
  -- Link cats to requests using proper attribution window
  WITH attribution_candidates AS (
    SELECT DISTINCT
      r.request_id,
      a.cat_id,
      a.appointment_date,
      -- Use source_created_at for legacy Airtable requests, fallback to created_at
      COALESCE(r.source_created_at, r.created_at) as effective_request_date,
      r.resolved_at,
      -- Classify attribution type
      CASE
        -- Cat fixed BEFORE request (up to 6 months before)
        WHEN a.appointment_date >= (COALESCE(r.source_created_at, r.created_at) - INTERVAL '6 months')::date
             AND a.appointment_date < COALESCE(r.source_created_at, r.created_at)::date
        THEN 'before_request'
        -- Cat fixed WHILE request active
        WHEN a.appointment_date >= COALESCE(r.source_created_at, r.created_at)::date
             AND (r.resolved_at IS NULL OR a.appointment_date <= r.resolved_at::date)
        THEN 'during_request'
        -- Cat fixed AFTER request closed (3 month grace)
        WHEN r.resolved_at IS NOT NULL
             AND a.appointment_date > r.resolved_at::date
             AND a.appointment_date <= (r.resolved_at + INTERVAL '3 months')::date
        THEN 'grace_period'
        ELSE NULL
      END as attribution_type
    FROM ops.requests r
    -- Join via place (appointment at request location)
    JOIN ops.appointments a ON (a.place_id = r.place_id OR a.inferred_place_id = r.place_id)
    JOIN sot.cats c ON c.cat_id = a.cat_id AND c.merged_into_cat_id IS NULL
    WHERE a.cat_id IS NOT NULL
      AND r.status NOT IN ('cancelled')
      -- Exclude already-linked cats
      AND NOT EXISTS (
        SELECT 1 FROM ops.request_cats rc
        WHERE rc.request_id = r.request_id AND rc.cat_id = a.cat_id
      )
  ),
  new_links AS (
    INSERT INTO ops.request_cats (request_id, cat_id, link_type, evidence_type, source_system)
    SELECT
      ac.request_id,
      ac.cat_id,
      'attributed',
      'inferred',
      'attribution_window'
    FROM attribution_candidates ac
    WHERE ac.attribution_type IS NOT NULL
    ON CONFLICT (request_id, cat_id) DO NOTHING
    RETURNING request_id, cat_id,
      (SELECT attribution_type FROM attribution_candidates ac2
       WHERE ac2.request_id = request_cats.request_id
         AND ac2.cat_id = request_cats.cat_id
       LIMIT 1) as attr_type
  )
  SELECT
    COUNT(*),
    COUNT(*) FILTER (WHERE attr_type = 'before_request'),
    COUNT(*) FILTER (WHERE attr_type = 'during_request'),
    COUNT(*) FILTER (WHERE attr_type = 'grace_period')
  INTO v_linked, v_before, v_during, v_grace
  FROM new_links;

  RETURN QUERY SELECT v_linked, 0, v_before, v_during, v_grace;
END;
$function$;

COMMENT ON FUNCTION sot.link_cats_to_requests_attribution() IS
'Links cats to requests using proper attribution window:
- 6 months BEFORE request creation (people fix cats before asking for help)
- DURING request (while active)
- 3 months AFTER resolution (grace period for late arrivals)
Returns counts by attribution type for monitoring.';

-- ============================================================================
-- 2. REPLACE BROKEN link_cats_to_requests_safe()
-- ============================================================================

\echo '2. Replacing sot.link_cats_to_requests_safe()...'

CREATE OR REPLACE FUNCTION sot.link_cats_to_requests_safe()
RETURNS TABLE(linked integer, skipped integer)
LANGUAGE plpgsql
AS $function$
DECLARE
  result RECORD;
BEGIN
  -- Delegate to the proper attribution function
  SELECT * INTO result FROM sot.link_cats_to_requests_attribution();
  RETURN QUERY SELECT result.linked, result.skipped;
END;
$function$;

COMMENT ON FUNCTION sot.link_cats_to_requests_safe() IS
'Wrapper for link_cats_to_requests_attribution().
Maintains backwards compatibility with entity linking pipeline.';

-- ============================================================================
-- 3. BACKFILL MISSING LINKS
-- ============================================================================

\echo '3. Backfilling missing cat-request links...'

\echo 'Before backfill:'
SELECT COUNT(*) as current_links FROM ops.request_cats;

-- Run the attribution function
SELECT * FROM sot.link_cats_to_requests_attribution();

\echo ''
\echo 'After backfill:'
SELECT COUNT(*) as total_links FROM ops.request_cats;

-- Show distribution by attribution source
\echo ''
\echo 'Links by source:'
SELECT source_system, COUNT(*) as count
FROM ops.request_cats
GROUP BY source_system
ORDER BY count DESC;

-- ============================================================================
-- 4. UPDATE v_request_list WITH CORRECT COUNT
-- ============================================================================

\echo ''
\echo '4. Verifying v_request_list linked_cat_count...'

-- Already updated in MIG_2471, verify it works
SELECT
  request_id,
  summary,
  linked_cat_count
FROM ops.v_request_list
WHERE linked_cat_count > 0
ORDER BY linked_cat_count DESC
LIMIT 5;

-- ============================================================================
-- 5. VERIFICATION QUERIES
-- ============================================================================

\echo ''
\echo '=============================================='
\echo '  VERIFICATION'
\echo '=============================================='

\echo ''
\echo '5a. Attribution window coverage:'
WITH attribution_analysis AS (
  SELECT
    r.request_id,
    a.cat_id,
    CASE
      WHEN a.appointment_date >= (COALESCE(r.source_created_at, r.created_at) - INTERVAL '6 months')::date
           AND a.appointment_date < COALESCE(r.source_created_at, r.created_at)::date
      THEN 'before_request'
      WHEN a.appointment_date >= COALESCE(r.source_created_at, r.created_at)::date
           AND (r.resolved_at IS NULL OR a.appointment_date <= r.resolved_at::date)
      THEN 'during_request'
      WHEN r.resolved_at IS NOT NULL
           AND a.appointment_date > r.resolved_at::date
           AND a.appointment_date <= (r.resolved_at + INTERVAL '3 months')::date
      THEN 'grace_period'
      ELSE 'outside'
    END as attr_type
  FROM ops.requests r
  JOIN ops.appointments a ON a.place_id = r.place_id OR a.inferred_place_id = r.place_id
  WHERE a.cat_id IS NOT NULL AND r.status NOT IN ('cancelled')
),
potential AS (
  SELECT DISTINCT request_id, cat_id FROM attribution_analysis WHERE attr_type != 'outside'
),
actual AS (
  SELECT request_id, cat_id FROM ops.request_cats
)
SELECT
  (SELECT COUNT(*) FROM potential) as should_have,
  (SELECT COUNT(*) FROM actual) as have_now,
  ROUND(100.0 * (SELECT COUNT(*) FROM actual) / NULLIF((SELECT COUNT(*) FROM potential), 0), 1) as coverage_pct;

\echo ''
\echo '5b. Requests with most linked cats:'
SELECT
  vrl.request_id,
  vrl.summary,
  vrl.status,
  vrl.linked_cat_count,
  vrl.estimated_cat_count
FROM ops.v_request_list vrl
WHERE vrl.linked_cat_count > 0
ORDER BY vrl.linked_cat_count DESC
LIMIT 10;

\echo ''
\echo '=============================================='
\echo '  MIG_2480 COMPLETE'
\echo '=============================================='
\echo ''
\echo 'Attribution window implemented:'
\echo '  - 6 months BEFORE request: Cats fixed before help requested'
\echo '  - DURING request: Standard active period'
\echo '  - 3 months AFTER: Grace period for late arrivals'
\echo ''
