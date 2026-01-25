-- MIG_563__colony_outcome_tracking.sql
-- Add outcome tracking to colony estimates for feedback loop learning
--
-- Purpose:
--   When trappers complete requests and report actual cat counts,
--   we can compare against prior estimates to:
--   1. Track estimate accuracy over time
--   2. Adjust source confidence weights based on actual outcomes
--   3. Improve future estimates through Bayesian updating
--
-- Key Concept:
--   observation_cats_seen + observation_eartips_seen from completion
--   becomes mark-resight data that improves Chapman estimates
--
-- MANUAL APPLY:
--   export $(cat .env | grep -v '^#' | xargs)
--   psql "$DATABASE_URL" -f sql/schema/sot/MIG_563__colony_outcome_tracking.sql

\echo ''
\echo '=============================================='
\echo 'MIG_563: Colony Outcome Tracking'
\echo '=============================================='
\echo ''

-- ============================================================
-- 1. Add mark-resight observation columns to place_colony_estimates
-- ============================================================

\echo 'Adding mark-resight observation columns...'

-- These columns store actual field observations for Chapman estimator
ALTER TABLE trapper.place_colony_estimates
ADD COLUMN IF NOT EXISTS total_cats_observed INTEGER,
ADD COLUMN IF NOT EXISTS eartip_count_observed INTEGER,
ADD COLUMN IF NOT EXISTS is_final_observation BOOLEAN DEFAULT FALSE;

COMMENT ON COLUMN trapper.place_colony_estimates.total_cats_observed IS
'C in Chapman formula: Total cats observed during site visit (for mark-resight)';

COMMENT ON COLUMN trapper.place_colony_estimates.eartip_count_observed IS
'R in Chapman formula: Ear-tipped cats observed (recaptures of marked population)';

COMMENT ON COLUMN trapper.place_colony_estimates.is_final_observation IS
'TRUE if this is the final observation for a completed request (higher reliability)';

-- ============================================================
-- 2. Add estimate accuracy tracking
-- ============================================================

\echo ''
\echo 'Adding accuracy tracking columns...'

ALTER TABLE trapper.place_colony_estimates
ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS verified_actual_count INTEGER,
ADD COLUMN IF NOT EXISTS accuracy_ratio NUMERIC(5,3);

COMMENT ON COLUMN trapper.place_colony_estimates.verified_at IS
'When this estimate was verified against actual outcome';

COMMENT ON COLUMN trapper.place_colony_estimates.verified_actual_count IS
'The actual count observed that verified/invalidated this estimate';

COMMENT ON COLUMN trapper.place_colony_estimates.accuracy_ratio IS
'Ratio of estimate to actual (1.0 = perfect, <1 = underestimate, >1 = overestimate)';

-- ============================================================
-- 3. Create source accuracy tracking table
-- ============================================================

\echo ''
\echo 'Creating source accuracy tracking table...'

CREATE TABLE IF NOT EXISTS trapper.colony_source_accuracy (
    accuracy_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_type TEXT NOT NULL REFERENCES trapper.colony_source_confidence(source_type),

    -- Rolling statistics
    total_estimates INTEGER DEFAULT 0,
    verified_estimates INTEGER DEFAULT 0,

    -- Accuracy metrics
    mean_accuracy_ratio NUMERIC(5,3),
    median_accuracy_ratio NUMERIC(5,3),
    stddev_accuracy_ratio NUMERIC(5,3),

    -- Underestimate/overestimate bias
    underestimate_count INTEGER DEFAULT 0,  -- estimate < actual
    overestimate_count INTEGER DEFAULT 0,   -- estimate > actual
    accurate_count INTEGER DEFAULT 0,       -- within 20% of actual

    -- Time-based tracking
    last_updated_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(source_type)
);

COMMENT ON TABLE trapper.colony_source_accuracy IS
'Tracks accuracy of colony estimates by source type over time.
Used to adjust confidence weights based on actual outcomes.';

-- Initialize with current source types
INSERT INTO trapper.colony_source_accuracy (source_type, total_estimates)
SELECT source_type, 0
FROM trapper.colony_source_confidence
ON CONFLICT (source_type) DO NOTHING;

-- ============================================================
-- 4. Function to record completion observation
-- ============================================================

\echo ''
\echo 'Creating record_completion_observation function...'

CREATE OR REPLACE FUNCTION trapper.record_completion_observation(
    p_request_id UUID,
    p_cats_seen INTEGER,
    p_eartips_seen INTEGER,
    p_notes TEXT DEFAULT NULL
) RETURNS UUID AS $$
DECLARE
    v_place_id UUID;
    v_estimate_id UUID;
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

    -- Insert observation
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

    -- If we have mark-resight data, compute Chapman estimate
    IF v_a_known > 0 AND p_cats_seen > 0 AND p_eartips_seen > 0 THEN
        -- Chapman estimate: N = ((M+1)(C+1)/(R+1)) - 1
        -- where M = marked (altered), C = captured (seen), R = recaptured (eartips seen)
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

Chapman formula: N = ((M+1)(C+1)/(R+1)) - 1
  M = Marked population (verified altered cats from clinic)
  C = Captured/observed cats during site visit
  R = Recaptured (ear-tipped cats seen, subset of M)';

-- ============================================================
-- 5. Function to verify prior estimates
-- ============================================================

\echo ''
\echo 'Creating verify_prior_estimates function...'

CREATE OR REPLACE FUNCTION trapper.verify_prior_estimates(
    p_place_id UUID,
    p_actual_count INTEGER
) RETURNS INTEGER AS $$
DECLARE
    v_verified_count INTEGER := 0;
    v_estimate RECORD;
BEGIN
    -- Find unverified estimates for this place from the last 180 days
    FOR v_estimate IN
        SELECT estimate_id, total_cats, source_type
        FROM trapper.place_colony_estimates
        WHERE place_id = p_place_id
          AND total_cats IS NOT NULL
          AND verified_at IS NULL
          AND observation_date >= CURRENT_DATE - INTERVAL '180 days'
          AND source_type != 'trapper_site_visit'  -- Don't verify observations against themselves
        ORDER BY observation_date DESC
    LOOP
        -- Calculate accuracy ratio (estimate / actual)
        UPDATE trapper.place_colony_estimates
        SET verified_at = NOW(),
            verified_actual_count = p_actual_count,
            accuracy_ratio = CASE
                WHEN p_actual_count > 0 THEN ROUND(v_estimate.total_cats::NUMERIC / p_actual_count, 3)
                ELSE NULL
            END
        WHERE estimate_id = v_estimate.estimate_id;

        v_verified_count := v_verified_count + 1;

        -- Update source accuracy statistics
        PERFORM trapper.update_source_accuracy(
            v_estimate.source_type,
            v_estimate.total_cats,
            p_actual_count
        );
    END LOOP;

    RETURN v_verified_count;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.verify_prior_estimates IS
'Compares prior estimates against an actual observation and records accuracy.
Called automatically when a completion observation is recorded.';

-- ============================================================
-- 6. Function to update source accuracy statistics
-- ============================================================

\echo ''
\echo 'Creating update_source_accuracy function...'

CREATE OR REPLACE FUNCTION trapper.update_source_accuracy(
    p_source_type TEXT,
    p_estimated INTEGER,
    p_actual INTEGER
) RETURNS VOID AS $$
DECLARE
    v_ratio NUMERIC(5,3);
    v_is_accurate BOOLEAN;
    v_is_under BOOLEAN;
    v_is_over BOOLEAN;
BEGIN
    IF p_actual IS NULL OR p_actual = 0 OR p_estimated IS NULL THEN
        RETURN;
    END IF;

    v_ratio := ROUND(p_estimated::NUMERIC / p_actual, 3);
    v_is_accurate := v_ratio BETWEEN 0.8 AND 1.2;  -- Within 20%
    v_is_under := v_ratio < 0.8;
    v_is_over := v_ratio > 1.2;

    -- Upsert source accuracy record
    INSERT INTO trapper.colony_source_accuracy (
        source_type,
        total_estimates,
        verified_estimates,
        underestimate_count,
        overestimate_count,
        accurate_count,
        last_updated_at
    ) VALUES (
        p_source_type,
        1,
        1,
        CASE WHEN v_is_under THEN 1 ELSE 0 END,
        CASE WHEN v_is_over THEN 1 ELSE 0 END,
        CASE WHEN v_is_accurate THEN 1 ELSE 0 END,
        NOW()
    )
    ON CONFLICT (source_type) DO UPDATE SET
        verified_estimates = colony_source_accuracy.verified_estimates + 1,
        underestimate_count = colony_source_accuracy.underestimate_count +
            CASE WHEN v_is_under THEN 1 ELSE 0 END,
        overestimate_count = colony_source_accuracy.overestimate_count +
            CASE WHEN v_is_over THEN 1 ELSE 0 END,
        accurate_count = colony_source_accuracy.accurate_count +
            CASE WHEN v_is_accurate THEN 1 ELSE 0 END,
        last_updated_at = NOW();

    -- Recompute mean accuracy ratio from all verified estimates
    UPDATE trapper.colony_source_accuracy csa
    SET mean_accuracy_ratio = sub.mean_ratio,
        stddev_accuracy_ratio = sub.stddev_ratio
    FROM (
        SELECT
            source_type,
            ROUND(AVG(accuracy_ratio), 3) AS mean_ratio,
            ROUND(STDDEV(accuracy_ratio), 3) AS stddev_ratio
        FROM trapper.place_colony_estimates
        WHERE source_type = p_source_type
          AND accuracy_ratio IS NOT NULL
        GROUP BY source_type
    ) sub
    WHERE csa.source_type = sub.source_type;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.update_source_accuracy IS
'Updates rolling accuracy statistics for a source type based on a verified estimate.';

-- ============================================================
-- 7. View for source accuracy dashboard
-- ============================================================

\echo ''
\echo 'Creating v_colony_source_accuracy view...'

CREATE OR REPLACE VIEW trapper.v_colony_source_accuracy AS
SELECT
    csc.source_type,
    csc.base_confidence,
    csc.description,

    -- From accuracy tracking
    COALESCE(csa.verified_estimates, 0) AS verified_estimates,
    csa.mean_accuracy_ratio,
    csa.stddev_accuracy_ratio,

    -- Accuracy breakdown
    COALESCE(csa.accurate_count, 0) AS accurate_count,
    COALESCE(csa.underestimate_count, 0) AS underestimate_count,
    COALESCE(csa.overestimate_count, 0) AS overestimate_count,

    -- Accuracy percentage
    CASE WHEN COALESCE(csa.verified_estimates, 0) > 0
         THEN ROUND(100.0 * csa.accurate_count / csa.verified_estimates, 1)
         ELSE NULL
    END AS accuracy_pct,

    -- Suggested confidence adjustment based on accuracy
    CASE
        WHEN csa.verified_estimates >= 10 THEN
            CASE
                WHEN csa.accurate_count::NUMERIC / csa.verified_estimates >= 0.7
                    THEN LEAST(1.0, csc.base_confidence + 0.10)  -- Boost accurate sources
                WHEN csa.accurate_count::NUMERIC / csa.verified_estimates <= 0.3
                    THEN GREATEST(0.20, csc.base_confidence - 0.15)  -- Penalize inaccurate
                ELSE csc.base_confidence
            END
        ELSE csc.base_confidence  -- Not enough data to adjust
    END AS suggested_confidence,

    csa.last_updated_at

FROM trapper.colony_source_confidence csc
LEFT JOIN trapper.colony_source_accuracy csa ON csa.source_type = csc.source_type
ORDER BY csc.base_confidence DESC;

COMMENT ON VIEW trapper.v_colony_source_accuracy IS
'Dashboard view showing source accuracy and suggested confidence adjustments.
Sources with >70% accuracy get boosted, <30% accuracy get penalized.
Requires at least 10 verified estimates before suggesting adjustments.';

-- ============================================================
-- 8. Function to apply learned confidence adjustments
-- ============================================================

\echo ''
\echo 'Creating apply_learned_confidence function...'

CREATE OR REPLACE FUNCTION trapper.apply_learned_confidence(
    p_min_samples INTEGER DEFAULT 20,
    p_dry_run BOOLEAN DEFAULT TRUE
) RETURNS TABLE (
    source_type TEXT,
    old_confidence NUMERIC,
    new_confidence NUMERIC,
    sample_size INTEGER,
    accuracy_pct NUMERIC
) AS $$
BEGIN
    RETURN QUERY
    WITH adjustments AS (
        SELECT
            v.source_type,
            v.base_confidence AS old_conf,
            v.suggested_confidence AS new_conf,
            v.verified_estimates,
            v.accuracy_pct
        FROM trapper.v_colony_source_accuracy v
        WHERE v.verified_estimates >= p_min_samples
          AND v.suggested_confidence != v.base_confidence
    )
    SELECT
        a.source_type,
        a.old_conf,
        a.new_conf,
        a.verified_estimates::INTEGER,
        a.accuracy_pct
    FROM adjustments a;

    -- Apply if not dry run
    IF NOT p_dry_run THEN
        UPDATE trapper.colony_source_confidence csc
        SET base_confidence = v.suggested_confidence
        FROM trapper.v_colony_source_accuracy v
        WHERE csc.source_type = v.source_type
          AND v.verified_estimates >= p_min_samples
          AND v.suggested_confidence != v.base_confidence;
    END IF;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.apply_learned_confidence IS
'Applies learned confidence adjustments based on verified accuracy.
Use p_dry_run = TRUE to preview changes, FALSE to apply them.
Requires p_min_samples (default 20) verified estimates before adjusting.';

-- ============================================================
-- 9. Update v_place_ecology_stats to use mark-resight observations
-- ============================================================

\echo ''
\echo 'Updating v_place_ecology_stats with better mark-resight aggregation...'

-- Add index for mark-resight queries
CREATE INDEX IF NOT EXISTS idx_colony_estimates_mark_resight
ON trapper.place_colony_estimates(place_id, observation_date DESC)
WHERE total_cats_observed IS NOT NULL AND eartip_count_observed IS NOT NULL;

-- ============================================================
-- 10. Verification
-- ============================================================

\echo ''
\echo '====== VERIFICATION ======'

\echo ''
\echo 'New columns added to place_colony_estimates:'
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'trapper'
  AND table_name = 'place_colony_estimates'
  AND column_name IN ('total_cats_observed', 'eartip_count_observed', 'is_final_observation',
                      'verified_at', 'verified_actual_count', 'accuracy_ratio')
ORDER BY column_name;

\echo ''
\echo 'Source accuracy tracking initialized:'
SELECT source_type, total_estimates, verified_estimates
FROM trapper.colony_source_accuracy
ORDER BY source_type;

\echo ''
\echo 'MIG_563 Complete!'
\echo ''
\echo 'New capabilities:'
\echo '  - record_completion_observation(request_id, cats_seen, eartips_seen) - Records field observation'
\echo '  - verify_prior_estimates(place_id, actual_count) - Compares estimates to actuals'
\echo '  - v_colony_source_accuracy - Dashboard for source accuracy'
\echo '  - apply_learned_confidence(min_samples, dry_run) - Apply learned adjustments'
\echo ''
\echo 'Flow:'
\echo '  1. Trapper completes request with observation data'
\echo '  2. record_completion_observation() creates mark-resight record'
\echo '  3. Chapman estimate computed if M, C, R all available'
\echo '  4. Prior estimates verified against actual observation'
\echo '  5. Source accuracy statistics updated'
\echo '  6. Periodically run apply_learned_confidence() to adjust weights'
\echo ''
