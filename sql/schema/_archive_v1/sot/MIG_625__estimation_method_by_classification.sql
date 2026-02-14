-- MIG_625: Estimation Method by Classification
--
-- Connects colony classification to the appropriate estimation method.
-- individual_cats → Simple verified count only (no ecology estimation)
-- small_colony → Weighted average (light estimation)
-- large_colony/feeding_station → Chapman mark-recapture if data available
--
-- This ensures that places like Crystal's (2 specific cats) don't get
-- confusing ecology estimates while true colonies get proper modeling.

\echo ''
\echo '========================================================'
\echo 'MIG_625: Estimation Method by Classification'
\echo '========================================================'
\echo ''

-- ============================================================
-- PART 1: Add estimation_method_preference column
-- ============================================================

\echo 'Adding estimation_method_preference column to places...'

ALTER TABLE trapper.places
ADD COLUMN IF NOT EXISTS estimation_method_preference TEXT
CHECK (estimation_method_preference IN ('auto', 'simple_count', 'weighted_average', 'chapman_mark_recapture'));

COMMENT ON COLUMN trapper.places.estimation_method_preference IS
'Override for estimation method. NULL or ''auto'' means derive from classification.';

-- ============================================================
-- PART 2: Create get_estimation_method function
-- ============================================================

\echo 'Creating get_estimation_method function...'

CREATE OR REPLACE FUNCTION trapper.get_estimation_method(
  p_place_id UUID
)
RETURNS TEXT AS $$
DECLARE
  v_place RECORD;
  v_has_eartip_data BOOLEAN;
BEGIN
  -- Get place data
  SELECT colony_classification, estimation_method_preference,
         authoritative_cat_count, colony_override_count
  INTO v_place
  FROM trapper.places
  WHERE place_id = p_place_id;

  IF v_place IS NULL THEN
    RETURN 'unknown';
  END IF;

  -- Check for explicit preference
  IF v_place.estimation_method_preference IS NOT NULL
     AND v_place.estimation_method_preference != 'auto' THEN
    RETURN v_place.estimation_method_preference;
  END IF;

  -- Check for authoritative count (always overrides)
  IF v_place.authoritative_cat_count IS NOT NULL THEN
    RETURN 'authoritative_count';
  END IF;

  -- Check for manual override
  IF v_place.colony_override_count IS NOT NULL THEN
    RETURN 'manual_override';
  END IF;

  -- Derive from classification
  CASE v_place.colony_classification
    WHEN 'individual_cats' THEN
      RETURN 'simple_count';

    WHEN 'small_colony' THEN
      RETURN 'weighted_average';

    WHEN 'large_colony', 'feeding_station' THEN
      -- Check if we have eartip data for Chapman
      SELECT EXISTS (
        SELECT 1 FROM trapper.place_colony_estimates pce
        WHERE pce.place_id = p_place_id
          AND pce.eartip_count_observed IS NOT NULL
          AND pce.eartip_count_observed > 0
          AND pce.total_cats_observed IS NOT NULL
          AND pce.total_cats_observed > pce.eartip_count_observed
      ) INTO v_has_eartip_data;

      IF v_has_eartip_data THEN
        RETURN 'chapman_mark_recapture';
      ELSE
        RETURN 'weighted_average';
      END IF;

    ELSE
      -- Unknown or NULL - use full estimation
      RETURN 'weighted_average';
  END CASE;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION trapper.get_estimation_method IS
'Determines the appropriate estimation method for a place based on its classification.
individual_cats → simple_count
small_colony → weighted_average
large_colony/feeding_station → chapman_mark_recapture (if data available)
Can be overridden by estimation_method_preference column.';

-- ============================================================
-- PART 3: Create enhanced colony status view
-- ============================================================

\echo 'Creating v_place_colony_status_enhanced view...'

CREATE OR REPLACE VIEW trapper.v_place_colony_status_enhanced AS
WITH verified_counts AS (
  SELECT
    cpr.place_id,
    COUNT(DISTINCT cpr.cat_id) AS verified_cat_count,
    COUNT(DISTINCT cpr.cat_id) FILTER (WHERE c.altered_status = 'Yes') AS verified_altered_count
  FROM trapper.cat_place_relationships cpr
  JOIN trapper.sot_cats c ON c.cat_id = cpr.cat_id
  WHERE c.merged_into_cat_id IS NULL
  GROUP BY cpr.place_id
),
estimate_aggregates AS (
  SELECT
    pce.place_id,
    -- Weighted average of estimates
    SUM(pce.total_cats * COALESCE(csc.base_confidence, 0.5) *
        CASE
          WHEN pce.observation_date > NOW() - INTERVAL '30 days' THEN 1.0
          WHEN pce.observation_date > NOW() - INTERVAL '90 days' THEN 0.9
          WHEN pce.observation_date > NOW() - INTERVAL '180 days' THEN 0.75
          WHEN pce.observation_date > NOW() - INTERVAL '365 days' THEN 0.5
          ELSE 0.25
        END
    ) / NULLIF(SUM(
        COALESCE(csc.base_confidence, 0.5) *
        CASE
          WHEN pce.observation_date > NOW() - INTERVAL '30 days' THEN 1.0
          WHEN pce.observation_date > NOW() - INTERVAL '90 days' THEN 0.9
          WHEN pce.observation_date > NOW() - INTERVAL '180 days' THEN 0.75
          WHEN pce.observation_date > NOW() - INTERVAL '365 days' THEN 0.5
          ELSE 0.25
        END
    ), 0) AS weighted_estimate,
    MAX(pce.total_cats) AS max_estimate,
    COUNT(*) AS estimate_count
  FROM trapper.place_colony_estimates pce
  LEFT JOIN trapper.colony_source_confidence csc ON csc.source_type = pce.source_type
  GROUP BY pce.place_id
)
SELECT
  p.place_id,
  p.formatted_address,
  p.display_name,
  p.colony_classification,
  p.authoritative_cat_count,
  p.colony_override_count,

  -- Estimation method (derived from classification)
  trapper.get_estimation_method(p.place_id) AS estimation_method,

  -- Colony size based on method
  CASE trapper.get_estimation_method(p.place_id)
    WHEN 'authoritative_count' THEN p.authoritative_cat_count
    WHEN 'manual_override' THEN p.colony_override_count
    WHEN 'simple_count' THEN COALESCE(vc.verified_cat_count, 0)
    ELSE GREATEST(
      COALESCE(ea.weighted_estimate, 0),
      COALESCE(vc.verified_cat_count, 0)
    )::INT
  END AS colony_size_estimate,

  -- Verified data
  COALESCE(vc.verified_cat_count, 0) AS verified_cat_count,
  COALESCE(vc.verified_altered_count, 0) AS verified_altered_count,

  -- Estimate data
  ea.weighted_estimate,
  ea.max_estimate,
  COALESCE(ea.estimate_count, 0) AS estimate_count,

  -- Work remaining
  CASE trapper.get_estimation_method(p.place_id)
    WHEN 'authoritative_count' THEN
      GREATEST(0, p.authoritative_cat_count - COALESCE(vc.verified_altered_count, 0))
    WHEN 'manual_override' THEN
      GREATEST(0, p.colony_override_count - COALESCE(vc.verified_altered_count, 0))
    WHEN 'simple_count' THEN
      GREATEST(0, COALESCE(vc.verified_cat_count, 0) - COALESCE(vc.verified_altered_count, 0))
    ELSE
      GREATEST(0, GREATEST(
        COALESCE(ea.weighted_estimate, 0),
        COALESCE(vc.verified_cat_count, 0)
      )::INT - COALESCE(vc.verified_altered_count, 0))
  END AS estimated_work_remaining,

  -- Confidence based on method
  CASE trapper.get_estimation_method(p.place_id)
    WHEN 'authoritative_count' THEN 1.0
    WHEN 'manual_override' THEN 0.95
    WHEN 'simple_count' THEN
      CASE WHEN vc.verified_cat_count > 0 THEN 0.95 ELSE 0.5 END
    WHEN 'chapman_mark_recapture' THEN 0.85
    ELSE 0.7
  END::NUMERIC AS confidence

FROM trapper.places p
LEFT JOIN verified_counts vc ON vc.place_id = p.place_id
LEFT JOIN estimate_aggregates ea ON ea.place_id = p.place_id
WHERE p.merged_into_place_id IS NULL;

COMMENT ON VIEW trapper.v_place_colony_status_enhanced IS
'Enhanced colony status view that uses classification to determine estimation method.
individual_cats uses simple_count, colonies use weighted_average or chapman.';

-- ============================================================
-- PART 4: Create estimation method summary view
-- ============================================================

\echo 'Creating v_estimation_method_summary view...'

CREATE OR REPLACE VIEW trapper.v_estimation_method_summary AS
SELECT
  trapper.get_estimation_method(p.place_id) AS estimation_method,
  p.colony_classification,
  COUNT(*) AS place_count,
  SUM(CASE WHEN p.authoritative_cat_count IS NOT NULL THEN 1 ELSE 0 END) AS with_authoritative_count,
  SUM(CASE WHEN p.colony_override_count IS NOT NULL THEN 1 ELSE 0 END) AS with_override
FROM trapper.places p
WHERE p.merged_into_place_id IS NULL
GROUP BY 1, 2
ORDER BY 1, 2;

COMMENT ON VIEW trapper.v_estimation_method_summary IS
'Summary of how many places use each estimation method by classification.';

-- ============================================================
-- VERIFICATION
-- ============================================================

\echo ''
\echo 'Verification:'

SELECT 'estimation_method_preference column' AS check_item,
       CASE WHEN EXISTS (
         SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'trapper' AND table_name = 'places'
         AND column_name = 'estimation_method_preference'
       ) THEN 'OK' ELSE 'MISSING' END AS status;

SELECT 'get_estimation_method function' AS check_item,
       CASE WHEN EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'get_estimation_method')
            THEN 'OK' ELSE 'MISSING' END AS status;

SELECT 'v_place_colony_status_enhanced view' AS check_item,
       CASE WHEN EXISTS (SELECT 1 FROM pg_views WHERE schemaname = 'trapper' AND viewname = 'v_place_colony_status_enhanced')
            THEN 'OK' ELSE 'MISSING' END AS status;

\echo ''
\echo 'Testing get_estimation_method for different classifications:'

-- This will only work if there are places with each classification
SELECT colony_classification, trapper.get_estimation_method(place_id) AS method
FROM trapper.places
WHERE colony_classification IS NOT NULL AND colony_classification != 'unknown'
LIMIT 10;

\echo ''
\echo '========================================================'
\echo 'MIG_625 Complete!'
\echo '========================================================'
\echo ''
\echo 'Estimation method by classification:'
\echo '  individual_cats → simple_count (verified cats only)'
\echo '  small_colony → weighted_average'
\echo '  large_colony/feeding_station → chapman (if data) or weighted_average'
\echo ''
\echo 'The v_place_colony_status_enhanced view now uses classification'
\echo 'to determine the appropriate estimation method automatically.'
\echo ''
