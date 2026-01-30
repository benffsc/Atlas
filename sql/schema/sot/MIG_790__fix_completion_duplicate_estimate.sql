-- ============================================================================
-- MIG_790: Fix duplicate colony estimate on request completion
-- ============================================================================
-- TASK_LEDGER reference: Audit finding (2026-01-29)
-- ACTIVE Impact: No (fixes enrichment table only — place_colony_estimates)
--
-- Problem:
--   CompleteRequestModal sends observation data to TWO endpoints:
--
--   Path A: POST /api/observations
--     → INSERT site_observations
--     → trigger trg_site_obs_colony_estimate fires
--     → INSERT place_colony_estimates (source_record_id = observation_id)
--
--   Path B: PATCH /api/requests/{id} with observation_cats_seen
--     → record_completion_observation()
--     → INSERT place_colony_estimates (source_record_id = NULL)
--
--   The UNIQUE (source_system, source_record_id) constraint doesn't catch this
--   because Path A has source_record_id = <UUID> and Path B has NULL,
--   and PostgreSQL treats NULL != NULL for unique constraints.
--
--   Result: TWO colony estimate records from the same observation.
--   - Record 1 (trigger): raw count only
--   - Record 2 (function): Chapman estimate + is_final_observation + verify
--
-- Fix:
--   Modify record_completion_observation() to detect the trigger-created
--   record and UPDATE it with enrichment data instead of INSERT-ing a
--   duplicate.
--
-- Rule established: INV-7 in ATLAS_NORTH_STAR.md
--   "One write path per destination table per user action."
-- ============================================================================

\echo '=== MIG_790: Fix completion duplicate colony estimate ==='

-- ============================================================================
-- Step 1: Pre-change state
-- ============================================================================

\echo ''
\echo 'Step 1: Pre-change state'

\echo 'Current record_completion_observation function exists:'
SELECT proname, pg_get_function_identity_arguments(oid) AS args
FROM pg_proc
WHERE proname = 'record_completion_observation'
  AND pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'trapper');

\echo ''
\echo 'Potential existing duplicates (same place + date from both paths):'
SELECT COUNT(*) AS potential_duplicates
FROM trapper.place_colony_estimates a
JOIN trapper.place_colony_estimates b
  ON a.place_id = b.place_id
  AND a.observation_date = b.observation_date
  AND a.estimate_id != b.estimate_id
WHERE a.source_record_id IS NOT NULL
  AND b.source_record_id IS NULL
  AND b.is_final_observation = TRUE
  AND a.source_system = 'atlas_ui'
  AND b.source_system = 'atlas_ui'
  AND a.observation_date = b.observation_date;

-- ============================================================================
-- Step 2: Replace record_completion_observation with dedup-aware version
-- ============================================================================

\echo ''
\echo 'Step 2: Replace record_completion_observation function'

CREATE OR REPLACE FUNCTION trapper.record_completion_observation(
    p_request_id UUID,
    p_cats_seen INTEGER,
    p_eartips_seen INTEGER,
    p_notes TEXT DEFAULT NULL
) RETURNS UUID AS $$
DECLARE
    v_place_id UUID;
    v_estimate_id UUID;
    v_existing_estimate_id UUID;
    v_a_known INTEGER;
BEGIN
    -- Get place_id for request
    SELECT place_id INTO v_place_id
    FROM trapper.sot_requests
    WHERE request_id = p_request_id;

    IF v_place_id IS NULL THEN
        RAISE NOTICE 'Request % has no place_id', p_request_id;
        RETURN NULL;
    END IF;

    -- Get current verified altered count (M in Chapman formula)
    SELECT COUNT(DISTINCT cp.cat_id)::INTEGER INTO v_a_known
    FROM trapper.cat_procedures cp
    JOIN trapper.cat_place_relationships cpr ON cpr.cat_id = cp.cat_id
    JOIN trapper.sot_cats c ON c.cat_id = cp.cat_id AND c.merged_into_cat_id IS NULL
    WHERE cpr.place_id = v_place_id
      AND (cp.is_spay OR cp.is_neuter);

    v_a_known := COALESCE(v_a_known, 0);

    -- ================================================================
    -- FIX (MIG_790): Check if the site_observations trigger already
    -- created a colony estimate for this request today.
    --
    -- The CompleteRequestModal POSTs to /api/observations first, which
    -- inserts a site_observations row. The trg_site_obs_colony_estimate
    -- trigger then creates a place_colony_estimates record with
    -- source_record_id = observation_id.
    --
    -- Instead of creating a duplicate, we UPDATE that record with the
    -- enrichment data (is_final_observation, Chapman, accuracy verify).
    -- ================================================================
    SELECT pce.estimate_id INTO v_existing_estimate_id
    FROM trapper.place_colony_estimates pce
    WHERE pce.place_id = v_place_id
      AND pce.observation_date = CURRENT_DATE
      AND pce.source_record_id IS NOT NULL
      AND EXISTS (
          SELECT 1 FROM trapper.site_observations so
          WHERE so.observation_id::text = pce.source_record_id
            AND so.request_id = p_request_id
      )
    ORDER BY pce.created_at DESC
    LIMIT 1;

    IF v_existing_estimate_id IS NOT NULL THEN
        -- UPDATE the trigger-created record with enrichment data
        UPDATE trapper.place_colony_estimates
        SET is_final_observation = TRUE,
            source_entity_type = 'request',
            source_entity_id = p_request_id,
            notes = COALESCE(p_notes, 'Final observation from request completion'),
            created_by = 'record_completion_observation'
        WHERE estimate_id = v_existing_estimate_id;

        v_estimate_id := v_existing_estimate_id;

        RAISE NOTICE 'MIG_790: Updated existing trigger-created estimate % instead of creating duplicate',
            v_existing_estimate_id;
    ELSE
        -- No trigger-created record found — INSERT as before (backward compatible)
        INSERT INTO trapper.place_colony_estimates (
            place_id,
            total_cats_observed,
            eartip_count_observed,
            is_final_observation,
            observation_date,
            notes,
            source_type,
            source_system,
            source_entity_type,
            source_entity_id,
            is_firsthand,
            created_by
        ) VALUES (
            v_place_id,
            p_cats_seen,
            p_eartips_seen,
            TRUE,
            CURRENT_DATE,
            COALESCE(p_notes, 'Final observation from request completion'),
            'trapper_site_visit',
            'atlas_ui',
            'request',
            p_request_id,
            TRUE,
            'record_completion_observation'
        )
        RETURNING estimate_id INTO v_estimate_id;
    END IF;

    -- If we have mark-resight data, compute Chapman estimate
    IF v_a_known > 0 AND p_cats_seen > 0 AND p_eartips_seen > 0 THEN
        DECLARE
            v_chapman_estimate INTEGER;
        BEGIN
            v_chapman_estimate := ROUND(
                ((v_a_known + 1) * (p_cats_seen + 1)::NUMERIC / (p_eartips_seen + 1)) - 1
            )::INTEGER;

            -- Update the estimate with computed total
            UPDATE trapper.place_colony_estimates
            SET total_cats = v_chapman_estimate,
                notes = COALESCE(notes, '') ||
                    format(E'\nChapman estimate: N=%s (M=%s altered, C=%s seen, R=%s eartipped)',
                           v_chapman_estimate, v_a_known, p_cats_seen, p_eartips_seen)
            WHERE estimate_id = v_estimate_id;

            RAISE NOTICE 'Chapman estimate for place %: % cats (M=%, C=%, R=%)',
                v_place_id, v_chapman_estimate, v_a_known, p_cats_seen, p_eartips_seen;
        END;
    END IF;

    -- Verify prior estimates against this observation
    PERFORM trapper.verify_prior_estimates(v_place_id, p_cats_seen);

    RETURN v_estimate_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.record_completion_observation IS
'Records a completion observation and computes Chapman estimate if mark-resight data available.
Also triggers verification of prior estimates against the actual observation.

MIG_790: Now detects if trg_site_obs_colony_estimate already created a colony estimate
from the same observation (via CompleteRequestModal dual-write). Updates existing record
instead of creating a duplicate.

Chapman formula: N = ((M+1)(C+1)/(R+1)) - 1
  M = Marked population (verified altered cats from clinic)
  C = Captured/observed cats during site visit
  R = Recaptured (ear-tipped cats seen, subset of M)';

-- ============================================================================
-- Step 3: Clean up existing duplicates
-- ============================================================================

\echo ''
\echo 'Step 3: Clean up existing duplicates'

-- Find and remove duplicate records created by the bug.
-- Keep the trigger-created record (has source_record_id linking to site_observation).
-- Remove the function-created duplicate (source_record_id IS NULL, is_final_observation).
WITH duplicates AS (
    SELECT b.estimate_id AS duplicate_id,
           a.estimate_id AS keep_id,
           a.place_id,
           a.observation_date
    FROM trapper.place_colony_estimates a
    JOIN trapper.place_colony_estimates b
      ON a.place_id = b.place_id
      AND a.observation_date = b.observation_date
      AND a.estimate_id != b.estimate_id
    WHERE a.source_record_id IS NOT NULL        -- trigger-created (keep)
      AND b.source_record_id IS NULL            -- function-created (remove)
      AND b.is_final_observation = TRUE
      AND b.created_by = 'record_completion_observation'
      AND a.source_system = 'atlas_ui'
      AND b.source_system = 'atlas_ui'
),
-- First, migrate enrichment data from duplicate to keeper
migrate AS (
    UPDATE trapper.place_colony_estimates pce
    SET is_final_observation = TRUE,
        source_entity_type = COALESCE(pce.source_entity_type, dup.source_entity_type),
        source_entity_id = COALESCE(pce.source_entity_id, dup.source_entity_id),
        total_cats = COALESCE(dup.total_cats, pce.total_cats),
        notes = COALESCE(dup.notes, pce.notes),
        created_by = 'record_completion_observation'
    FROM (
        SELECT d.keep_id, b.*
        FROM duplicates d
        JOIN trapper.place_colony_estimates b ON b.estimate_id = d.duplicate_id
    ) dup
    WHERE pce.estimate_id = dup.keep_id
    RETURNING pce.estimate_id
)
SELECT COUNT(*) AS migrated FROM migrate;

-- Now delete the duplicates
WITH duplicates AS (
    SELECT b.estimate_id AS duplicate_id
    FROM trapper.place_colony_estimates a
    JOIN trapper.place_colony_estimates b
      ON a.place_id = b.place_id
      AND a.observation_date = b.observation_date
      AND a.estimate_id != b.estimate_id
    WHERE a.source_record_id IS NOT NULL
      AND b.source_record_id IS NULL
      AND b.is_final_observation = TRUE
      AND b.created_by = 'record_completion_observation'
      AND a.source_system = 'atlas_ui'
      AND b.source_system = 'atlas_ui'
)
DELETE FROM trapper.place_colony_estimates
WHERE estimate_id IN (SELECT duplicate_id FROM duplicates);

\echo 'Duplicates cleaned up (enrichment data migrated to trigger-created records).'

-- ============================================================================
-- Step 4: Post-change verification
-- ============================================================================

\echo ''
\echo 'Step 4: Verify function replaced'

SELECT proname, pg_get_function_identity_arguments(oid) AS args
FROM pg_proc
WHERE proname = 'record_completion_observation'
  AND pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'trapper');

\echo ''
\echo 'Verify no remaining duplicates:'
SELECT COUNT(*) AS remaining_duplicates
FROM trapper.place_colony_estimates a
JOIN trapper.place_colony_estimates b
  ON a.place_id = b.place_id
  AND a.observation_date = b.observation_date
  AND a.estimate_id != b.estimate_id
WHERE a.source_record_id IS NOT NULL
  AND b.source_record_id IS NULL
  AND b.is_final_observation = TRUE
  AND a.source_system = 'atlas_ui'
  AND b.source_system = 'atlas_ui';

-- ============================================================================
-- Step 5: Safety Gate (light — this is Historical/Analytical data zone)
-- ============================================================================

\echo ''
\echo 'Step 5: Safety Gate (light)'

\echo 'Colony estimates table intact:'
SELECT COUNT(*) AS total_estimates FROM trapper.place_colony_estimates;

\echo ''
\echo 'site_observations trigger still enabled:'
SELECT tgname, CASE tgenabled WHEN 'O' THEN 'enabled' WHEN 'D' THEN 'DISABLED' END AS status
FROM pg_trigger
WHERE tgrelid = 'trapper.site_observations'::regclass
  AND tgname = 'trg_site_obs_colony_estimate';

\echo ''
\echo 'Core views resolve:'
SELECT 'v_place_colony_status' AS view_name, COUNT(*) AS rows FROM trapper.v_place_colony_status
UNION ALL
SELECT 'v_colony_source_accuracy', COUNT(*) FROM trapper.v_colony_source_accuracy;

-- ============================================================================
-- Step 6: Summary
-- ============================================================================

\echo ''
\echo '====== MIG_790 SUMMARY ======'
\echo 'Fixed duplicate colony estimate on request completion.'
\echo ''
\echo 'Before: CompleteRequestModal dual-write created TWO colony estimates:'
\echo '  Path A: POST /api/observations → trigger → place_colony_estimates'
\echo '  Path B: PATCH /api/requests/{id} → record_completion_observation() → place_colony_estimates'
\echo ''
\echo 'After:  record_completion_observation() detects the trigger-created'
\echo '  record and UPDATEs it with enrichment (is_final_observation,'
\echo '  Chapman estimate, accuracy verification) instead of INSERT-ing'
\echo '  a duplicate.'
\echo ''
\echo 'Backward compatible: If no trigger record exists (e.g. completions'
\echo '  without the observations modal), function still INSERT-s as before.'
\echo ''
\echo 'Existing duplicates cleaned up with enrichment data migrated.'
\echo ''
\echo 'Rule: INV-7 added to ATLAS_NORTH_STAR.md — One write path per'
\echo '  destination table per user action.'
\echo '=== MIG_790 Complete ==='
