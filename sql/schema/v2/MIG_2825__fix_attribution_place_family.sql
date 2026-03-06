-- MIG_2825: Fix Cat-Request Attribution with Place Family (FFS-163, FFS-164)
--
-- PROBLEMS:
-- 1. FFS-163: Attribution uses direct place_id comparison instead of
--    get_place_family() — cats at child/unit places miss linkage to
--    parent-place requests (e.g., Toni Lecompte: 4/5 cats missing)
-- 2. FFS-164: V2 entity linking cron dropped cat-request linking (Step 4).
--    Legacy ingest_auto links created 54 invalid links (2016-2023 cats
--    on a Sept 2025 request). 20+ requests affected with 300+ bad links.
--
-- SOLUTION:
-- 1. Rewrite link_cats_to_requests_attribution() with place family expansion
-- 2. Create cleanup_stale_request_cat_links() to remove bad automated links
-- 3. Add Step 4 to run_all_entity_linking() orchestrator
--
-- Depends on: MIG_2824 (apartment hierarchy backfill)
-- Created: 2026-03-05

\echo ''
\echo '=============================================='
\echo '  MIG_2825: Fix Attribution + Orchestrator Step 4'
\echo '=============================================='
\echo ''

-- ============================================================================
-- 1. REWRITE ATTRIBUTION WITH PLACE FAMILY
-- ============================================================================

\echo '1. Rewriting sot.link_cats_to_requests_attribution()...'

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
  -- Link cats to requests using proper attribution window + place family expansion.
  -- Place family ensures that cats at child/unit/co-located places are attributed
  -- to requests at the parent building (and vice versa).
  WITH request_families AS (
    -- Pre-expand place families for all non-cancelled requests with a place.
    -- One get_place_family() call per request (~400-500 calls), acceptable for cron.
    SELECT
      r.request_id,
      r.place_id,
      r.status,
      COALESCE(r.source_created_at, r.created_at) as effective_request_date,
      r.resolved_at,
      fp as family_place_id
    FROM ops.requests r
    CROSS JOIN LATERAL UNNEST(sot.get_place_family(r.place_id)) AS fp
    WHERE r.status NOT IN ('cancelled')
      AND r.place_id IS NOT NULL
  ),
  attribution_candidates AS (
    SELECT DISTINCT
      rf.request_id,
      a.cat_id,
      a.appointment_date,
      rf.effective_request_date,
      rf.resolved_at,
      -- Classify attribution type
      CASE
        -- Cat fixed BEFORE request (up to 6 months before)
        WHEN a.appointment_date >= (rf.effective_request_date - INTERVAL '6 months')::date
             AND a.appointment_date < rf.effective_request_date::date
        THEN 'before_request'
        -- Cat fixed WHILE request active
        WHEN a.appointment_date >= rf.effective_request_date::date
             AND (rf.resolved_at IS NULL OR a.appointment_date <= rf.resolved_at::date)
        THEN 'during_request'
        -- Cat fixed AFTER request closed (3 month grace)
        WHEN rf.resolved_at IS NOT NULL
             AND a.appointment_date > rf.resolved_at::date
             AND a.appointment_date <= (rf.resolved_at + INTERVAL '3 months')::date
        THEN 'grace_period'
        ELSE NULL
      END as attribution_type
    FROM request_families rf
    -- Match appointments via expanded place family
    JOIN ops.appointments a ON (a.inferred_place_id = rf.family_place_id OR a.place_id = rf.family_place_id)
    JOIN sot.cats c ON c.cat_id = a.cat_id AND c.merged_into_cat_id IS NULL
    WHERE a.cat_id IS NOT NULL
      -- Exclude already-linked cats
      AND NOT EXISTS (
        SELECT 1 FROM ops.request_cats rc
        WHERE rc.request_id = rf.request_id AND rc.cat_id = a.cat_id
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
'MIG_2825: Links cats to requests using place family expansion + attribution window.
Uses CROSS JOIN LATERAL UNNEST(get_place_family()) to match cats at child/unit/co-located
places to requests at parent buildings (and vice versa).
Attribution windows: 6mo before, during, 3mo grace after resolution.
Replaces MIG_2480 version which used direct place_id comparison only.';

\echo '   Rewrote sot.link_cats_to_requests_attribution()'

-- ============================================================================
-- 2. CREATE STALE LINK CLEANUP FUNCTION
-- ============================================================================

\echo ''
\echo '2. Creating sot.cleanup_stale_request_cat_links()...'

CREATE OR REPLACE FUNCTION sot.cleanup_stale_request_cat_links()
RETURNS INTEGER
LANGUAGE plpgsql
AS $function$
DECLARE
  v_removed INTEGER := 0;
BEGIN
  -- Delete automated links where the cat's appointment is outside the
  -- attribution window for the request (using place family matching).
  -- Preserves manual/UI links — only touches automated source_systems.
  WITH request_families AS (
    SELECT
      r.request_id,
      COALESCE(r.source_created_at, r.created_at) as effective_request_date,
      r.resolved_at,
      fp as family_place_id
    FROM ops.requests r
    CROSS JOIN LATERAL UNNEST(sot.get_place_family(r.place_id)) AS fp
    WHERE r.place_id IS NOT NULL
  ),
  stale_links AS (
    SELECT rc.id
    FROM ops.request_cats rc
    -- Only clean up automated links
    WHERE rc.source_system IN ('attribution_window', 'ingest_auto', 'clinichq')
      AND rc.evidence_type IN ('inferred', 'appointment')
      -- Check: does this cat actually have an appointment within the
      -- attribution window at a place in the request's family?
      AND NOT EXISTS (
        SELECT 1
        FROM request_families rf
        JOIN ops.appointments a ON (a.inferred_place_id = rf.family_place_id OR a.place_id = rf.family_place_id)
        WHERE rf.request_id = rc.request_id
          AND a.cat_id = rc.cat_id
          AND a.appointment_date IS NOT NULL
          -- Attribution window: 6mo before → 3mo after resolution
          AND a.appointment_date >= (rf.effective_request_date - INTERVAL '6 months')::date
          AND (
            rf.resolved_at IS NULL
            OR a.appointment_date <= (rf.resolved_at + INTERVAL '3 months')::date
          )
      )
  )
  DELETE FROM ops.request_cats
  WHERE id IN (SELECT id FROM stale_links);

  GET DIAGNOSTICS v_removed = ROW_COUNT;
  RETURN v_removed;
END;
$function$;

COMMENT ON FUNCTION sot.cleanup_stale_request_cat_links() IS
'MIG_2825: Removes automated cat-request links that are outside the attribution window.
Only deletes links with source_system IN (attribution_window, ingest_auto, clinichq)
and evidence_type IN (inferred, appointment). Never touches manual/UI links.
Uses place family expansion for proper matching.';

\echo '   Created sot.cleanup_stale_request_cat_links()'

-- ============================================================================
-- 3. ADD STEP 4 TO run_all_entity_linking() ORCHESTRATOR
-- ============================================================================

\echo ''
\echo '3. Adding Step 4 to sot.run_all_entity_linking()...'

CREATE OR REPLACE FUNCTION sot.run_all_entity_linking()
RETURNS JSONB AS $$
DECLARE
    v_result JSONB := '{}'::jsonb;
    v_warnings TEXT[] := '{}';
    v_start TIMESTAMPTZ;
    v_row RECORD;
    v_count INT;
    v_skipped INT;
    v_total_appointments INT;
    v_appointments_with_place INT;
    v_total_cats INT;
    v_cats_with_place INT;
    v_run_id INT;
    v_status TEXT := 'completed';
    -- Step 4 variables
    v_before INT;
    v_during INT;
    v_grace INT;
    v_stale_removed INT;
BEGIN
    v_start := clock_timestamp();

    -- Get baseline counts
    SELECT COUNT(*) INTO v_total_appointments FROM ops.appointments;
    SELECT COUNT(*) INTO v_total_cats FROM sot.cats WHERE merged_into_cat_id IS NULL;

    -- ========================================================================
    -- STEP 1: Link appointments to places
    -- ========================================================================
    FOR v_row IN SELECT * FROM sot.link_appointments_to_places() LOOP
        v_result := v_result || jsonb_build_object(
            'step1_' || v_row.source || '_linked', v_row.appointments_linked,
            'step1_' || v_row.source || '_unmatched', v_row.appointments_unmatched
        );
    END LOOP;

    -- Step 1 validation: Check coverage
    SELECT COUNT(*) INTO v_appointments_with_place
    FROM ops.appointments WHERE inferred_place_id IS NOT NULL;

    v_result := v_result || jsonb_build_object(
        'step1_total_appointments', v_total_appointments,
        'step1_with_inferred_place', v_appointments_with_place,
        'step1_coverage_pct', ROUND(100.0 * v_appointments_with_place / NULLIF(v_total_appointments, 0), 1)
    );

    -- Warning if coverage is low
    IF v_appointments_with_place < (v_total_appointments * 0.5) THEN
        v_warnings := array_append(v_warnings, 'step1_low_coverage: only ' ||
            v_appointments_with_place || ' of ' || v_total_appointments || ' appointments have places');
    END IF;

    -- ========================================================================
    -- STEP 2: Link cats to places via appointments (PRIMARY)
    -- ========================================================================
    SELECT cats_linked, cats_skipped INTO v_count, v_skipped
    FROM sot.link_cats_to_appointment_places();

    v_result := v_result || jsonb_build_object(
        'step2_cats_linked', v_count,
        'step2_cats_skipped', v_skipped
    );

    -- ========================================================================
    -- STEP 3: Link cats to places via person chain (SECONDARY)
    -- ========================================================================
    SELECT total_edges INTO v_count FROM sot.link_cats_to_places();

    v_result := v_result || jsonb_build_object(
        'step3_cats_linked', v_count
    );

    -- ========================================================================
    -- STEP 4: Cat-Request Attribution (MIG_2825)
    -- ========================================================================

    -- Step 4a: Cleanup stale automated links
    v_stale_removed := sot.cleanup_stale_request_cat_links();

    -- Step 4b: Create new valid links via attribution window + place family
    SELECT linked, before_request, during_request, grace_period
    INTO v_count, v_before, v_during, v_grace
    FROM sot.link_cats_to_requests_attribution();

    v_result := v_result || jsonb_build_object(
        'step4_cats_linked_to_requests', v_count,
        'step4_stale_links_removed', v_stale_removed,
        'step4_before_request', v_before,
        'step4_during_request', v_during,
        'step4_grace_period', v_grace
    );

    -- ========================================================================
    -- FINAL VALIDATION
    -- ========================================================================
    SELECT COUNT(DISTINCT cat_id) INTO v_cats_with_place FROM sot.cat_place;

    v_result := v_result || jsonb_build_object(
        'total_cats', v_total_cats,
        'cats_with_place_link', v_cats_with_place,
        'cat_coverage_pct', ROUND(100.0 * v_cats_with_place / NULLIF(v_total_cats, 0), 1),
        'duration_ms', EXTRACT(MILLISECONDS FROM clock_timestamp() - v_start)::INT,
        'status', v_status
    );

    -- Add warnings if any
    IF array_length(v_warnings, 1) > 0 THEN
        v_result := v_result || jsonb_build_object('warnings', v_warnings);
        v_status := 'completed_with_warnings';
    END IF;

    -- Log run to history table
    INSERT INTO ops.entity_linking_runs (result, status, warnings, completed_at)
    VALUES (v_result, v_status, v_warnings, NOW())
    RETURNING run_id INTO v_run_id;

    v_result := v_result || jsonb_build_object('run_id', v_run_id);

    RETURN v_result;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION sot.run_all_entity_linking IS
'V2/MIG_2825: Master orchestrator for entity linking pipeline with validation.
Order of execution:
1. link_appointments_to_places() - Resolve inferred_place_id
2. link_cats_to_appointment_places() - PRIMARY: appointment-based cat-place linking
3. link_cats_to_places() - SECONDARY: person chain fallback
4. Cat-Request Attribution (NEW):
   4a. cleanup_stale_request_cat_links() - Remove outdated automated links
   4b. link_cats_to_requests_attribution() - Create valid links via place family + attribution window

Returns JSONB with coverage percentages, duration, run_id, warnings.';

\echo '   Updated sot.run_all_entity_linking() with Step 4'

-- ============================================================================
-- 4. UPDATE v_entity_linking_history VIEW
-- ============================================================================

\echo ''
\echo '4. Updating ops.v_entity_linking_history view...'

CREATE OR REPLACE VIEW ops.v_entity_linking_history AS
SELECT
    run_id,
    status,
    (result->>'step1_total_appointments')::int as total_appointments,
    (result->>'step1_with_inferred_place')::int as appointments_with_place,
    (result->>'step1_coverage_pct')::numeric as appointment_coverage_pct,
    (result->>'step2_cats_linked')::int as cats_via_appointments,
    (result->>'step2_cats_skipped')::int as cats_skipped,
    (result->>'step3_cats_linked')::int as cats_via_person_chain,
    (result->>'step4_cats_linked_to_requests')::int as cats_linked_to_requests,
    (result->>'step4_stale_links_removed')::int as stale_links_removed,
    (result->>'total_cats')::int as total_cats,
    (result->>'cats_with_place_link')::int as cats_with_place,
    (result->>'cat_coverage_pct')::numeric as cat_coverage_pct,
    (result->>'duration_ms')::int as duration_ms,
    warnings,
    created_at,
    completed_at
FROM ops.entity_linking_runs
ORDER BY created_at DESC;

COMMENT ON VIEW ops.v_entity_linking_history IS
'Friendly view of entity linking run history with extracted metrics.
MIG_2825: Added step4_cats_linked_to_requests and stale_links_removed columns.';

\echo '   Updated ops.v_entity_linking_history'

-- ============================================================================
-- 5. RUN CLEANUP + RE-LINK
-- ============================================================================

\echo ''
\echo '=============================================='
\echo '  RUNNING CLEANUP + RE-LINK'
\echo '=============================================='

\echo ''
\echo '5a. Before cleanup - link counts by source_system:'
SELECT source_system, COUNT(*) as count
FROM ops.request_cats
GROUP BY source_system
ORDER BY count DESC;

\echo ''
\echo '5b. Running stale link cleanup...'
SELECT sot.cleanup_stale_request_cat_links() as stale_links_removed;

\echo ''
\echo '5c. After cleanup - link counts by source_system:'
SELECT source_system, COUNT(*) as count
FROM ops.request_cats
GROUP BY source_system
ORDER BY count DESC;

\echo ''
\echo '5d. Running attribution with place family...'
SELECT * FROM sot.link_cats_to_requests_attribution();

\echo ''
\echo '5e. Final link counts by source_system:'
SELECT source_system, COUNT(*) as count
FROM ops.request_cats
GROUP BY source_system
ORDER BY count DESC;

-- ============================================================================
-- 6. VERIFICATION
-- ============================================================================

\echo ''
\echo '=============================================='
\echo '  VERIFICATION'
\echo '=============================================='

\echo ''
\echo '6a. Toni Lecompte request (should be 5 cats):'
SELECT COUNT(*) as cat_count
FROM ops.request_cats
WHERE request_id = 'c0a499b1-b782-4cb2-8c9c-49865ee41d67';

\echo ''
\echo '6b. Toni Lecompte cats detail:'
SELECT rc.cat_id, c.microchip, c.cat_name, rc.source_system, rc.evidence_type
FROM ops.request_cats rc
JOIN sot.cats c ON c.cat_id = rc.cat_id
WHERE rc.request_id = 'c0a499b1-b782-4cb2-8c9c-49865ee41d67';

\echo ''
\echo '6c. Corrine Hodges request:'
SELECT COUNT(*) as cat_count
FROM ops.request_cats
WHERE request_id = '033adf61-fbe2-46eb-8fe5-05c0ebd51ef9';

\echo ''
\echo '6d. Full pipeline test:'
SELECT jsonb_pretty(sot.run_all_entity_linking()) as run_result;

\echo ''
\echo '=============================================='
\echo '  MIG_2825 Complete'
\echo '=============================================='
\echo ''
\echo 'Changes:'
\echo '  - Rewrote attribution with place family expansion (FFS-163)'
\echo '  - Added stale link cleanup function (FFS-164)'
\echo '  - Added Step 4 to run_all_entity_linking() orchestrator (FFS-164)'
\echo '  - Updated v_entity_linking_history view with Step 4 columns'
\echo ''
