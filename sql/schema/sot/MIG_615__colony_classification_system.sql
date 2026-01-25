-- MIG_615: Colony Classification System
--
-- Problem: The estimation system treats all places the same, but there are two
-- fundamentally different patterns:
--
-- 1. INDIVIDUAL CATS: Specific cats in a neighborhood (Crystal's situation)
--    - Exact counts are known and authoritative
--    - Should NOT cluster with nearby addresses
--    - Ecological projection doesn't apply at the address level
--    - But these cats DO inform regional population models
--
-- 2. COLONY SITES: Established feeding locations (Jean Worthey's situation)
--    - Many cats, hard to count exactly
--    - Ecological estimation (Chapman, etc.) is appropriate
--    - Nearby appointments SHOULD cluster to this site
--    - Multiple sources inform the estimate
--
-- Solution: Add classification system that affects how estimates are calculated

\echo ''
\echo '========================================================'
\echo 'MIG_615: Colony Classification System'
\echo '========================================================'
\echo ''

-- ============================================================
-- PART 1: Add colony classification enum
-- ============================================================

\echo 'Creating colony classification enum...'

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'colony_classification') THEN
    CREATE TYPE trapper.colony_classification AS ENUM (
      'unknown',           -- Default, needs classification
      'individual_cats',   -- Sporadic cats, exact counts known, no clustering
      'small_colony',      -- Small established group (3-10 cats), light estimation
      'large_colony',      -- Large colony (10+), full ecological estimation
      'feeding_station'    -- Known feeding station, attracts cats from area
    );
  END IF;
END $$;

COMMENT ON TYPE trapper.colony_classification IS
'Classification of a place for colony estimation purposes:
- unknown: Default, needs classification by staff
- individual_cats: Sporadic cats, exact counts are authoritative, no clustering
- small_colony: Small established group, some estimation appropriate
- large_colony: Large colony, full ecological estimation applies
- feeding_station: Known feeding station that attracts cats from surrounding area';

-- ============================================================
-- PART 2: Add classification to places
-- ============================================================

\echo 'Adding colony_classification to places...'

ALTER TABLE trapper.places
ADD COLUMN IF NOT EXISTS colony_classification trapper.colony_classification DEFAULT 'unknown';

ALTER TABLE trapper.places
ADD COLUMN IF NOT EXISTS colony_classification_reason TEXT;

ALTER TABLE trapper.places
ADD COLUMN IF NOT EXISTS colony_classification_set_by TEXT;

ALTER TABLE trapper.places
ADD COLUMN IF NOT EXISTS colony_classification_set_at TIMESTAMPTZ;

COMMENT ON COLUMN trapper.places.colony_classification IS
'How this place should be treated for colony estimation.
individual_cats = exact counts authoritative, no clustering.
colony = ecological estimation appropriate.';

COMMENT ON COLUMN trapper.places.colony_classification_reason IS
'Why this classification was chosen (staff note)';

-- ============================================================
-- PART 3: Add authoritative count system
-- ============================================================

\echo 'Adding authoritative count fields to places...'

ALTER TABLE trapper.places
ADD COLUMN IF NOT EXISTS authoritative_cat_count INTEGER;

ALTER TABLE trapper.places
ADD COLUMN IF NOT EXISTS authoritative_count_reason TEXT;

ALTER TABLE trapper.places
ADD COLUMN IF NOT EXISTS authoritative_count_set_by TEXT;

ALTER TABLE trapper.places
ADD COLUMN IF NOT EXISTS authoritative_count_set_at TIMESTAMPTZ;

COMMENT ON COLUMN trapper.places.authoritative_cat_count IS
'Staff-confirmed exact cat count. Overrides all estimates when set.
Use for individual_cats situations where exact count is known.';

-- ============================================================
-- PART 4: Add clustering eligibility
-- ============================================================

\echo 'Adding clustering fields...'

ALTER TABLE trapper.places
ADD COLUMN IF NOT EXISTS allows_clustering BOOLEAN DEFAULT TRUE;

ALTER TABLE trapper.places
ADD COLUMN IF NOT EXISTS clustering_radius_meters INTEGER;

COMMENT ON COLUMN trapper.places.allows_clustering IS
'Whether nearby appointments can be clustered to this place.
FALSE for individual_cats situations to prevent incorrect attribution.';

COMMENT ON COLUMN trapper.places.clustering_radius_meters IS
'Custom clustering radius for this place. NULL uses system default.';

-- ============================================================
-- PART 5: Create function to set classification
-- ============================================================

\echo 'Creating classification function...'

CREATE OR REPLACE FUNCTION trapper.set_colony_classification(
  p_place_id UUID,
  p_classification trapper.colony_classification,
  p_reason TEXT DEFAULT NULL,
  p_set_by TEXT DEFAULT 'system',
  p_authoritative_count INTEGER DEFAULT NULL
) RETURNS VOID AS $$
BEGIN
  UPDATE trapper.places
  SET
    colony_classification = p_classification,
    colony_classification_reason = p_reason,
    colony_classification_set_by = p_set_by,
    colony_classification_set_at = NOW(),
    allows_clustering = CASE p_classification
      WHEN 'individual_cats' THEN FALSE
      WHEN 'unknown' THEN TRUE
      ELSE TRUE
    END,
    authoritative_cat_count = COALESCE(p_authoritative_count, authoritative_cat_count),
    authoritative_count_reason = CASE
      WHEN p_authoritative_count IS NOT NULL THEN COALESCE(p_reason, authoritative_count_reason)
      ELSE authoritative_count_reason
    END,
    authoritative_count_set_by = CASE
      WHEN p_authoritative_count IS NOT NULL THEN p_set_by
      ELSE authoritative_count_set_by
    END,
    authoritative_count_set_at = CASE
      WHEN p_authoritative_count IS NOT NULL THEN NOW()
      ELSE authoritative_count_set_at
    END
  WHERE place_id = p_place_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.set_colony_classification IS
'Set colony classification for a place. Sets clustering rules based on classification.
For individual_cats, clustering is disabled automatically.';

-- ============================================================
-- PART 6: Update v_place_colony_status to respect classification
-- ============================================================

\echo 'Updating v_place_colony_status to respect classification...'

DROP VIEW IF EXISTS trapper.v_place_colony_status CASCADE;

CREATE OR REPLACE VIEW trapper.v_place_colony_status AS
WITH
verified_counts AS (
    SELECT
        cpr.place_id,
        COUNT(DISTINCT cpr.cat_id) AS verified_cat_count,
        COUNT(DISTINCT cpr.cat_id) FILTER (
            WHERE EXISTS (
                SELECT 1 FROM trapper.cat_procedures cp
                WHERE cp.cat_id = cpr.cat_id
                AND (cp.is_spay OR cp.is_neuter)
            )
        ) AS verified_altered_count,
        MAX(cpr.created_at) AS last_verified_at
    FROM trapper.cat_place_relationships cpr
    JOIN trapper.sot_cats c ON c.cat_id = cpr.cat_id
        AND c.merged_into_cat_id IS NULL
    GROUP BY cpr.place_id
),
weighted_estimates AS (
    SELECT
        e.place_id,
        e.estimate_id,
        e.total_cats,
        e.total_cats_min,
        e.total_cats_max,
        e.adult_count,
        e.kitten_count,
        e.altered_count,
        e.unaltered_count,
        e.friendly_count,
        e.feral_count,
        e.source_type,
        e.observation_date,
        e.reported_at,
        e.is_firsthand,
        e.count_precision,
        COALESCE(sc.base_confidence, 0.50) AS base_confidence,
        COALESCE(e.number_confidence, cpf.default_number_confidence, 0.80) AS number_confidence,
        COALESCE(sc.supersession_tier, 1) AS tier,
        EXTRACT(DAY FROM NOW() - COALESCE(e.observation_date::timestamptz, e.reported_at)) AS days_ago,
        CASE
            WHEN EXTRACT(DAY FROM NOW() - COALESCE(e.observation_date::timestamptz, e.reported_at)) <= 30 THEN 1.0
            WHEN EXTRACT(DAY FROM NOW() - COALESCE(e.observation_date::timestamptz, e.reported_at)) <= 90 THEN 0.90
            WHEN EXTRACT(DAY FROM NOW() - COALESCE(e.observation_date::timestamptz, e.reported_at)) <= 180 THEN 0.75
            WHEN EXTRACT(DAY FROM NOW() - COALESCE(e.observation_date::timestamptz, e.reported_at)) <= 365 THEN 0.50
            ELSE 0.25
        END AS recency_factor,
        CASE WHEN e.is_firsthand THEN COALESCE(sc.is_firsthand_boost, 0.05) ELSE 0 END AS firsthand_boost
    FROM trapper.place_colony_estimates e
    LEFT JOIN trapper.colony_source_confidence sc ON sc.source_type = e.source_type
    LEFT JOIN trapper.count_precision_factors cpf ON cpf.precision_type = e.count_precision
    WHERE e.total_cats IS NOT NULL
      AND e.total_cats > 0
      AND (e.is_excluded IS NULL OR e.is_excluded = FALSE)
      AND (e.is_superseded IS NULL OR e.is_superseded = FALSE)
),
aggregated AS (
    SELECT
        place_id,
        ROUND(
            SUM(total_cats * base_confidence * number_confidence * recency_factor * (1 + firsthand_boost))
            / NULLIF(SUM(base_confidence * number_confidence * recency_factor * (1 + firsthand_boost)), 0)
        )::INT AS weighted_estimate,
        (ARRAY_AGG(total_cats ORDER BY tier DESC, is_firsthand DESC NULLS LAST, observation_date DESC NULLS LAST))[1] AS best_single_estimate,
        MIN(COALESCE(total_cats_min, total_cats)) AS estimate_min,
        MAX(COALESCE(total_cats_max, total_cats)) AS estimate_max,
        SUM(adult_count) AS est_adults,
        SUM(kitten_count) AS est_kittens,
        SUM(altered_count) AS est_altered,
        SUM(unaltered_count) AS est_unaltered,
        SUM(friendly_count) AS est_friendly,
        SUM(feral_count) AS est_feral,
        COUNT(*) AS estimate_count,
        COUNT(*) FILTER (WHERE days_ago <= 90) AS recent_estimate_count,
        AVG(base_confidence * number_confidence * recency_factor * (1 + firsthand_boost)) AS avg_confidence,
        COUNT(DISTINCT source_type) > 1 AS is_multi_source,
        (ARRAY_AGG(source_type ORDER BY tier DESC, base_confidence * recency_factor DESC))[1] AS primary_source,
        MAX(observation_date) AS latest_observation
    FROM weighted_estimates
    GROUP BY place_id
),
place_data AS (
    SELECT
        p.place_id,
        p.display_name AS place_name,
        p.formatted_address,
        p.service_zone,
        p.colony_override_count,
        p.colony_override_altered,
        p.colony_override_note,
        p.colony_override_at,
        p.colony_override_by,
        p.colony_classification,
        p.authoritative_cat_count,
        p.authoritative_count_reason,
        p.allows_clustering
    FROM trapper.places p
)
SELECT
    COALESCE(pd.place_id, vc.place_id, agg.place_id) AS place_id,
    pd.place_name,
    pd.formatted_address,
    pd.service_zone,
    COALESCE(vc.verified_cat_count, 0) AS verified_cat_count,
    COALESCE(vc.verified_altered_count, 0) AS verified_altered_count,
    vc.last_verified_at,
    agg.weighted_estimate AS raw_estimated_total,
    agg.best_single_estimate,
    agg.estimate_min,
    agg.estimate_max,
    -- Colony size respects classification
    CASE
        WHEN pd.authoritative_cat_count IS NOT NULL THEN pd.authoritative_cat_count
        WHEN pd.colony_override_count IS NOT NULL THEN pd.colony_override_count
        WHEN pd.colony_classification = 'individual_cats' THEN COALESCE(vc.verified_cat_count, 0)
        ELSE GREATEST(COALESCE(agg.weighted_estimate, 0), COALESCE(vc.verified_cat_count, 0))
    END AS colony_size_estimate,
    agg.est_adults,
    agg.est_kittens,
    agg.est_altered,
    agg.est_unaltered,
    agg.est_friendly,
    agg.est_feral,
    COALESCE(agg.estimate_count, 0) AS estimate_count,
    COALESCE(agg.recent_estimate_count, 0) AS recent_estimate_count,
    agg.avg_confidence,
    COALESCE(agg.is_multi_source, FALSE) AS is_multi_source_confirmed,
    -- Confidence respects classification
    CASE
        WHEN pd.authoritative_cat_count IS NOT NULL THEN 1.0
        WHEN pd.colony_classification = 'individual_cats' THEN 0.95
        WHEN vc.verified_cat_count > 0 THEN LEAST(1.0, COALESCE(agg.avg_confidence, 0.5) + 0.2)
        ELSE COALESCE(agg.avg_confidence, 0)
    END AS final_confidence,
    agg.primary_source,
    agg.latest_observation,
    -- Work remaining respects classification
    CASE
        WHEN pd.authoritative_cat_count IS NOT NULL
        THEN GREATEST(0, pd.authoritative_cat_count - COALESCE(vc.verified_altered_count, 0))
        WHEN pd.colony_override_count IS NOT NULL
        THEN GREATEST(0, pd.colony_override_count - COALESCE(vc.verified_altered_count, 0))
        WHEN pd.colony_classification = 'individual_cats'
        THEN GREATEST(0, COALESCE(vc.verified_cat_count, 0) - COALESCE(vc.verified_altered_count, 0))
        ELSE GREATEST(0,
            GREATEST(COALESCE(agg.weighted_estimate, 0), COALESCE(vc.verified_cat_count, 0))
            - COALESCE(vc.verified_altered_count, 0)
        )
    END AS estimated_work_remaining,
    -- Alteration rate
    CASE
        WHEN CASE
            WHEN pd.authoritative_cat_count IS NOT NULL THEN pd.authoritative_cat_count
            WHEN pd.colony_override_count IS NOT NULL THEN pd.colony_override_count
            WHEN pd.colony_classification = 'individual_cats' THEN COALESCE(vc.verified_cat_count, 0)
            ELSE GREATEST(COALESCE(agg.weighted_estimate, 0), COALESCE(vc.verified_cat_count, 0))
        END > 0
        THEN LEAST(100.0,
            COALESCE(vc.verified_altered_count, 0)::NUMERIC * 100.0 /
            CASE
                WHEN pd.authoritative_cat_count IS NOT NULL THEN pd.authoritative_cat_count
                WHEN pd.colony_override_count IS NOT NULL THEN pd.colony_override_count
                WHEN pd.colony_classification = 'individual_cats' THEN COALESCE(vc.verified_cat_count, 0)
                ELSE GREATEST(COALESCE(agg.weighted_estimate, 0), COALESCE(vc.verified_cat_count, 0))
            END
        )
        ELSE NULL
    END AS alteration_rate_pct,
    (pd.colony_override_count IS NOT NULL OR pd.authoritative_cat_count IS NOT NULL) AS has_override,
    pd.colony_override_count,
    pd.colony_override_altered,
    COALESCE(pd.authoritative_count_reason, pd.colony_override_note) AS colony_override_note,
    pd.colony_override_at,
    pd.colony_override_by,
    -- Estimation method
    CASE
        WHEN pd.authoritative_cat_count IS NOT NULL THEN 'Authoritative Count'
        WHEN pd.colony_override_count IS NOT NULL THEN 'Manual Override'
        WHEN pd.colony_classification = 'individual_cats' THEN 'Individual Cats (Verified Only)'
        WHEN vc.verified_cat_count > COALESCE(agg.weighted_estimate, 0) THEN 'Verified (exceeds estimate)'
        WHEN agg.weighted_estimate IS NOT NULL THEN 'Estimated'
        WHEN vc.verified_cat_count > 0 THEN 'Verified Only'
        ELSE 'No Data'
    END AS estimation_method,
    -- Classification fields
    pd.colony_classification,
    pd.authoritative_cat_count,
    pd.allows_clustering
FROM place_data pd
FULL OUTER JOIN verified_counts vc ON vc.place_id = pd.place_id
FULL OUTER JOIN aggregated agg ON agg.place_id = COALESCE(pd.place_id, vc.place_id);

COMMENT ON VIEW trapper.v_place_colony_status IS
'Colony status per place with weighted confidence scoring.
Respects colony_classification: individual_cats uses verified count only.
Respects authoritative_cat_count which overrides all estimates.
Excludes estimates marked as is_excluded=TRUE or is_superseded=TRUE.';

-- ============================================================
-- VERIFICATION
-- ============================================================

\echo ''
\echo 'Verification:'

SELECT 'Places with classification' AS check_type,
       colony_classification::TEXT,
       COUNT(*) AS count
FROM trapper.places
GROUP BY colony_classification;

\echo ''
\echo '========================================================'
\echo 'MIG_615 Complete!'
\echo '========================================================'
\echo ''
\echo 'New capabilities:'
\echo '  1. colony_classification: individual_cats, small_colony, large_colony, feeding_station'
\echo '  2. authoritative_cat_count: Staff can set exact count that overrides estimates'
\echo '  3. allows_clustering: Controls whether nearby appointments cluster to this place'
\echo '  4. v_place_colony_status now respects classification'
\echo ''
\echo 'Usage:'
\echo '  SELECT trapper.set_colony_classification('
\echo '    place_id,'
\echo '    ''individual_cats'','
\echo '    ''Reason for classification'','
\echo '    ''staff_name'','
\echo '    2  -- optional authoritative count'
\echo '  );'
\echo ''
