-- MIG_609: Colony Estimate Exclusions
--
-- Purpose: Allow staff to mark colony estimates as excluded from assessment
-- with a reason. This is useful when an estimate is outdated, incorrect, or
-- otherwise shouldn't be included in colony size calculations.
--
-- Use Case Example:
--   - An AI-parsed report extracted "50 cats" from a note that was actually
--     referring to a different location
--   - An old survey from 5 years ago is no longer relevant
--   - A duplicate estimate was entered by mistake

\echo ''
\echo '=============================================='
\echo 'MIG_609: Colony Estimate Exclusions'
\echo '=============================================='
\echo ''

-- ============================================================
-- 1. Add exclusion columns to place_colony_estimates
-- ============================================================

\echo 'Adding exclusion columns to place_colony_estimates...'

ALTER TABLE trapper.place_colony_estimates
ADD COLUMN IF NOT EXISTS is_excluded BOOLEAN DEFAULT FALSE;

ALTER TABLE trapper.place_colony_estimates
ADD COLUMN IF NOT EXISTS exclusion_reason TEXT;

ALTER TABLE trapper.place_colony_estimates
ADD COLUMN IF NOT EXISTS excluded_at TIMESTAMPTZ;

ALTER TABLE trapper.place_colony_estimates
ADD COLUMN IF NOT EXISTS excluded_by TEXT;

COMMENT ON COLUMN trapper.place_colony_estimates.is_excluded IS
'When true, this estimate is excluded from colony size calculations. Use for outdated, incorrect, or duplicate estimates.';

COMMENT ON COLUMN trapper.place_colony_estimates.exclusion_reason IS
'Staff-provided reason for excluding this estimate (e.g., "Outdated - colony relocated", "Duplicate entry", "AI parsing error")';

COMMENT ON COLUMN trapper.place_colony_estimates.excluded_at IS
'Timestamp when the estimate was marked as excluded';

COMMENT ON COLUMN trapper.place_colony_estimates.excluded_by IS
'Staff member who excluded this estimate';

-- ============================================================
-- 2. Update v_place_colony_status to exclude marked estimates
-- ============================================================

\echo 'Updating v_place_colony_status view to filter excluded estimates...'

-- First drop if exists (views can't be replaced if columns change)
DROP VIEW IF EXISTS trapper.v_place_colony_status CASCADE;

CREATE OR REPLACE VIEW trapper.v_place_colony_status AS
WITH estimates AS (
    SELECT
        e.place_id,
        e.source_type,
        e.total_cats,
        e.altered_count,
        e.observation_date,
        e.reported_at,
        e.is_firsthand,
        COALESCE(c.base_confidence, 0.5) as source_confidence,
        COALESCE(c.is_firsthand_boost, 0.05) as firsthand_boost,
        -- Recency decay: estimates older than 2 years get reduced confidence
        CASE
            WHEN e.observation_date IS NULL THEN 0.8
            WHEN e.observation_date > CURRENT_DATE - INTERVAL '6 months' THEN 1.0
            WHEN e.observation_date > CURRENT_DATE - INTERVAL '1 year' THEN 0.9
            WHEN e.observation_date > CURRENT_DATE - INTERVAL '2 years' THEN 0.7
            ELSE 0.5
        END as recency_factor
    FROM trapper.place_colony_estimates e
    LEFT JOIN trapper.colony_source_confidence c ON c.source_type = e.source_type
    WHERE e.total_cats IS NOT NULL
      AND e.total_cats > 0
      AND (e.is_excluded IS NULL OR e.is_excluded = FALSE)  -- Exclude marked estimates
),
verified_cats AS (
    -- Cats with verified clinic visits linked to this place
    SELECT
        cpr.place_id,
        COUNT(DISTINCT cpr.cat_id) as verified_count,
        COUNT(DISTINCT cpr.cat_id) FILTER (WHERE c.altered_status IN ('neutered', 'spayed', 'Yes')) as altered_count
    FROM trapper.cat_place_relationships cpr
    JOIN trapper.sot_cats c ON c.cat_id = cpr.cat_id
    GROUP BY cpr.place_id
),
estimate_stats AS (
    SELECT
        place_id,
        -- Weighted average of estimates
        ROUND(
            SUM(total_cats * source_confidence * recency_factor * (1 + CASE WHEN is_firsthand THEN firsthand_boost ELSE 0 END))
            / NULLIF(SUM(source_confidence * recency_factor * (1 + CASE WHEN is_firsthand THEN firsthand_boost ELSE 0 END)), 0)
        )::INTEGER as weighted_estimate,
        -- Max reported (for conservative estimates)
        MAX(total_cats) as max_reported,
        -- Count of estimates
        COUNT(*) as estimate_count,
        -- Multi-source confirmation
        COUNT(DISTINCT source_type) > 1 as is_multi_source,
        -- Best source
        (ARRAY_AGG(source_type ORDER BY source_confidence * recency_factor DESC))[1] as primary_source,
        -- Average confidence
        AVG(source_confidence * recency_factor) as avg_confidence
    FROM estimates
    GROUP BY place_id
)
SELECT
    COALESCE(es.place_id, vc.place_id) as place_id,
    -- Colony size: use verified if higher, otherwise weighted estimate
    GREATEST(
        COALESCE(es.weighted_estimate, 0),
        COALESCE(vc.verified_count, 0)
    ) as colony_size_estimate,
    COALESCE(vc.verified_count, 0) as verified_cat_count,
    COALESCE(vc.altered_count, 0) as verified_altered_count,
    -- Confidence: boost if verified data available
    CASE
        WHEN vc.verified_count IS NOT NULL AND vc.verified_count > 0 THEN
            LEAST(1.0, COALESCE(es.avg_confidence, 0.5) + 0.2)
        ELSE
            COALESCE(es.avg_confidence, 0)
    END as final_confidence,
    COALESCE(es.estimate_count, 0) as estimate_count,
    es.primary_source,
    vc.verified_count IS NOT NULL AND vc.verified_count > 0 as has_clinic_boost,
    COALESCE(es.is_multi_source, FALSE) as is_multi_source_confirmed,
    -- Estimated work remaining: colony size minus altered cats
    GREATEST(0,
        GREATEST(
            COALESCE(es.weighted_estimate, 0),
            COALESCE(vc.verified_count, 0)
        ) - COALESCE(vc.altered_count, 0)
    ) as estimated_work_remaining
FROM estimate_stats es
FULL OUTER JOIN verified_cats vc ON vc.place_id = es.place_id;

COMMENT ON VIEW trapper.v_place_colony_status IS
'Computed colony status per place with confidence scoring.
Excludes estimates marked as is_excluded = TRUE.
Combines survey data, verified cats, and multi-source confirmation.';

-- ============================================================
-- 3. Index for quick filtering
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_colony_estimates_excluded
    ON trapper.place_colony_estimates(place_id) WHERE is_excluded = TRUE;

\echo ''
\echo '=== MIG_609 Complete ==='
\echo 'Added is_excluded, exclusion_reason, excluded_at, excluded_by columns'
\echo 'Updated v_place_colony_status to filter excluded estimates'
\echo ''
