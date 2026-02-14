-- MIG_612: Estimate Supersession Model
--
-- Problem: Lower-confidence estimates (requester guesses) dilute higher-confidence
-- observations (trapper firsthand counts) in weighted averages. Example:
--   - Requester says "4 cats" (secondhand, 60% confidence)
--   - Trapper visits and counts "7 cats" (firsthand, 80% confidence)
--   - Weighted average = 6 (ecologically wrong - trapper count should win)
--
-- Solution: Implement estimate supersession where:
--   1. Higher-confidence firsthand observations can supersede lower-confidence estimates
--   2. Superseded estimates remain for historical analysis but excluded from aggregation
--   3. Supersession is automatic based on source hierarchy, not manual override
--   4. Keeps ecology calculations running on best-available data
--
-- Scientific basis:
--   - Mark-resight studies distinguish preliminary vs verified counts
--   - More recent observations from trained observers supersede earlier guesses
--   - This follows Bayesian updating: posterior (trapper count) replaces prior (requester guess)

\echo ''
\echo '=============================================='
\echo 'MIG_612: Estimate Supersession Model'
\echo '=============================================='
\echo ''

-- ============================================================
-- 1. Add supersession columns to place_colony_estimates
-- ============================================================

\echo 'Adding supersession columns...'

-- Mark if this estimate has been superseded by a better one
ALTER TABLE trapper.place_colony_estimates
ADD COLUMN IF NOT EXISTS is_superseded BOOLEAN DEFAULT FALSE;

-- Reference to the estimate that superseded this one
ALTER TABLE trapper.place_colony_estimates
ADD COLUMN IF NOT EXISTS superseded_by_estimate_id UUID REFERENCES trapper.place_colony_estimates(estimate_id);

-- When it was superseded
ALTER TABLE trapper.place_colony_estimates
ADD COLUMN IF NOT EXISTS superseded_at TIMESTAMPTZ;

-- Reason for supersession (auto or manual)
ALTER TABLE trapper.place_colony_estimates
ADD COLUMN IF NOT EXISTS supersession_reason TEXT;

-- Add number confidence (how precise is the count itself, separate from source confidence)
-- Values: 'exact' (counted each cat), 'approximate' (rough count), 'range' (min-max given), 'lower_bound' (at least N)
ALTER TABLE trapper.place_colony_estimates
ADD COLUMN IF NOT EXISTS count_precision TEXT DEFAULT 'approximate';

-- Store min/max if a range was given (e.g., "7-10 cats")
ALTER TABLE trapper.place_colony_estimates
ADD COLUMN IF NOT EXISTS total_cats_min INT;

ALTER TABLE trapper.place_colony_estimates
ADD COLUMN IF NOT EXISTS total_cats_max INT;

-- Number confidence factor (0.0 to 1.0) - how confident are we in the actual number?
-- Separate from source confidence (who reported) - this is about the precision of the count
ALTER TABLE trapper.place_colony_estimates
ADD COLUMN IF NOT EXISTS number_confidence NUMERIC(3,2) DEFAULT 0.80;

COMMENT ON COLUMN trapper.place_colony_estimates.is_superseded IS
'TRUE if this estimate has been superseded by a more reliable observation. Superseded estimates are excluded from aggregation but kept for history.';

COMMENT ON COLUMN trapper.place_colony_estimates.superseded_by_estimate_id IS
'Reference to the estimate that superseded this one.';

COMMENT ON COLUMN trapper.place_colony_estimates.count_precision IS
'How precise is the count:
  - exact: Individually counted each cat (e.g., "I counted 7 cats")
  - approximate: Rough estimate (e.g., "about 15 cats")
  - range: Min-max given (e.g., "10-15 cats")
  - lower_bound: At least N (e.g., "at least 7 cats")';

COMMENT ON COLUMN trapper.place_colony_estimates.total_cats_min IS
'Lower bound if a range was given (e.g., "at least 7" → min=7, max=NULL)';

COMMENT ON COLUMN trapper.place_colony_estimates.total_cats_max IS
'Upper bound if a range was given';

COMMENT ON COLUMN trapper.place_colony_estimates.number_confidence IS
'How confident we are in the count number itself (0.0-1.0):
  - 1.0 for exact counts ("I counted 7")
  - 0.8 for approximate ("about 15")
  - 0.7 for wide ranges ("10-20")
  - 0.9 for narrow ranges ("7-8")
Separate from source confidence which is about WHO reported.';

-- ============================================================
-- 1b. Create count precision reference table
-- ============================================================

\echo 'Creating count precision reference...'

CREATE TABLE IF NOT EXISTS trapper.count_precision_factors (
  precision_type TEXT PRIMARY KEY,
  default_number_confidence NUMERIC(3,2) NOT NULL,
  description TEXT,
  examples TEXT[]
);

INSERT INTO trapper.count_precision_factors (precision_type, default_number_confidence, description, examples)
VALUES
  ('exact', 1.00, 'Individually counted each cat', ARRAY['I counted 7 cats', '7 cats total']),
  ('approximate', 0.80, 'Rough estimate, typically ±20%', ARRAY['about 15 cats', 'around 10', 'roughly 20']),
  ('range', 0.85, 'Explicit range given', ARRAY['10-15 cats', 'between 5 and 8']),
  ('lower_bound', 0.75, 'At least N cats, upper bound unknown', ARRAY['at least 7', '7+ cats', 'minimum of 10']),
  ('upper_bound', 0.70, 'No more than N cats', ARRAY['no more than 5', 'at most 10']),
  ('unknown', 0.60, 'Precision not specified', ARRAY['some cats', 'a few'])
ON CONFLICT (precision_type) DO UPDATE SET
  default_number_confidence = EXCLUDED.default_number_confidence,
  description = EXCLUDED.description,
  examples = EXCLUDED.examples;

COMMENT ON TABLE trapper.count_precision_factors IS
'Reference table for count precision types and their default number confidence factors.
Used in weighted calculations to account for uncertainty in the count itself.';

-- ============================================================
-- 2. Define source hierarchy for supersession
-- ============================================================

\echo 'Adding supersession tier to colony_source_confidence...'

-- Add supersession tier (higher tier supersedes lower tier)
ALTER TABLE trapper.colony_source_confidence
ADD COLUMN IF NOT EXISTS supersession_tier INT DEFAULT 1;

COMMENT ON COLUMN trapper.colony_source_confidence.supersession_tier IS
'Higher tiers supersede lower tiers. Tier 3 (trapper observation) supersedes Tier 1 (requester guess).';

-- Set tiers based on data quality
-- Tier 3: Firsthand observations by trained staff/trappers
-- Tier 2: Structured surveys and intake data
-- Tier 1: Requester estimates and AI-parsed notes

UPDATE trapper.colony_source_confidence SET supersession_tier = 3
WHERE source_type IN ('verified_cats', 'staff_verified', 'trapper_site_visit', 'trapper_report', 'post_clinic_survey');

UPDATE trapper.colony_source_confidence SET supersession_tier = 2
WHERE source_type IN ('atlas_observation', 'manual_observation', 'intake_form');

UPDATE trapper.colony_source_confidence SET supersession_tier = 1
WHERE source_type IN ('trapping_request', 'appointment_request', 'ai_parsed', 'legacy_mymaps',
                       'intake_situation_parse', 'internal_notes_parse', 'tippy_ai_observation',
                       'appointment_notes_parse');

-- ============================================================
-- 3. Create supersession function
-- ============================================================

\echo 'Creating supersession function...'

CREATE OR REPLACE FUNCTION trapper.apply_estimate_supersession(
  p_place_id UUID,
  p_new_estimate_id UUID DEFAULT NULL
)
RETURNS TABLE (
  superseded_count INT,
  details JSONB
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_superseded_count INT := 0;
  v_details JSONB := '[]'::JSONB;
  v_new_estimate RECORD;
  v_new_tier INT;
BEGIN
  -- If a specific new estimate is provided, use it as the superseding estimate
  -- Otherwise, find the best current estimate for the place

  IF p_new_estimate_id IS NOT NULL THEN
    SELECT e.*, COALESCE(sc.supersession_tier, 1) as tier
    INTO v_new_estimate
    FROM trapper.place_colony_estimates e
    LEFT JOIN trapper.colony_source_confidence sc ON sc.source_type = e.source_type
    WHERE e.estimate_id = p_new_estimate_id;

    v_new_tier := v_new_estimate.tier;
  ELSE
    -- Find the highest-tier, most recent, firsthand estimate
    SELECT e.*, COALESCE(sc.supersession_tier, 1) as tier
    INTO v_new_estimate
    FROM trapper.place_colony_estimates e
    LEFT JOIN trapper.colony_source_confidence sc ON sc.source_type = e.source_type
    WHERE e.place_id = p_place_id
      AND e.total_cats IS NOT NULL
      AND (e.is_superseded IS NULL OR e.is_superseded = FALSE)
      AND (e.is_excluded IS NULL OR e.is_excluded = FALSE)
    ORDER BY
      COALESCE(sc.supersession_tier, 1) DESC,
      e.is_firsthand DESC NULLS LAST,
      e.observation_date DESC NULLS LAST,
      e.reported_at DESC
    LIMIT 1;

    v_new_tier := COALESCE(v_new_estimate.tier, 1);
  END IF;

  -- If no qualifying estimate found, nothing to supersede
  IF v_new_estimate.estimate_id IS NULL THEN
    RETURN QUERY SELECT 0, '[]'::JSONB;
    RETURN;
  END IF;

  -- Supersede lower-tier estimates that are:
  -- 1. From lower supersession tier
  -- 2. Not already superseded
  -- 3. Not excluded
  -- 4. For the same place
  -- 5. From before the superseding estimate
  WITH to_supersede AS (
    SELECT e.estimate_id, e.source_type, e.total_cats, sc.supersession_tier
    FROM trapper.place_colony_estimates e
    LEFT JOIN trapper.colony_source_confidence sc ON sc.source_type = e.source_type
    WHERE e.place_id = p_place_id
      AND e.estimate_id != v_new_estimate.estimate_id
      AND (e.is_superseded IS NULL OR e.is_superseded = FALSE)
      AND (e.is_excluded IS NULL OR e.is_excluded = FALSE)
      AND COALESCE(sc.supersession_tier, 1) < v_new_tier
      -- Only supersede if the new estimate is firsthand OR from a significantly higher tier
      AND (v_new_estimate.is_firsthand = TRUE OR v_new_tier >= COALESCE(sc.supersession_tier, 1) + 2)
  ),
  updated AS (
    UPDATE trapper.place_colony_estimates e
    SET
      is_superseded = TRUE,
      superseded_by_estimate_id = v_new_estimate.estimate_id,
      superseded_at = NOW(),
      supersession_reason = format(
        'Auto-superseded by %s observation (%s cats, tier %s)',
        v_new_estimate.source_type,
        v_new_estimate.total_cats,
        v_new_tier
      )
    FROM to_supersede ts
    WHERE e.estimate_id = ts.estimate_id
    RETURNING e.estimate_id, ts.source_type, ts.total_cats
  )
  SELECT COUNT(*)::INT, jsonb_agg(jsonb_build_object(
    'estimate_id', estimate_id,
    'source_type', source_type,
    'total_cats', total_cats
  ))
  INTO v_superseded_count, v_details
  FROM updated;

  RETURN QUERY SELECT COALESCE(v_superseded_count, 0), COALESCE(v_details, '[]'::JSONB);
END;
$$;

COMMENT ON FUNCTION trapper.apply_estimate_supersession IS
'Automatically supersedes lower-tier estimates when a higher-tier observation is recorded.
Superseded estimates remain for historical analysis but are excluded from aggregation.
This follows Bayesian updating principles used in mark-resight studies.';

-- ============================================================
-- 4. Create trigger to auto-apply supersession on new estimates
-- ============================================================

\echo 'Creating auto-supersession trigger...'

CREATE OR REPLACE FUNCTION trapper.trigger_estimate_supersession()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_tier INT;
BEGIN
  -- Only apply for firsthand observations from higher tiers
  SELECT supersession_tier INTO v_tier
  FROM trapper.colony_source_confidence
  WHERE source_type = NEW.source_type;

  -- Tier 2+ firsthand observations trigger supersession
  IF NEW.is_firsthand = TRUE AND COALESCE(v_tier, 1) >= 2 THEN
    PERFORM trapper.apply_estimate_supersession(NEW.place_id, NEW.estimate_id);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_estimate_supersession ON trapper.place_colony_estimates;

CREATE TRIGGER trg_estimate_supersession
AFTER INSERT ON trapper.place_colony_estimates
FOR EACH ROW
EXECUTE FUNCTION trapper.trigger_estimate_supersession();

-- ============================================================
-- 5. Update v_place_colony_status to exclude superseded estimates
-- ============================================================

\echo 'Updating v_place_colony_status to exclude superseded estimates...'

-- First drop dependent views
DROP VIEW IF EXISTS trapper.v_request_colony_summary CASCADE;
DROP VIEW IF EXISTS trapper.v_place_hierarchy_estimates CASCADE;
DROP VIEW IF EXISTS trapper.v_cluster_colony_estimates CASCADE;
DROP VIEW IF EXISTS trapper.v_beacon_clusters_with_estimates CASCADE;
DROP VIEW IF EXISTS trapper.v_cluster_colony_projected CASCADE;
DROP VIEW IF EXISTS trapper.v_place_colony_projected CASCADE;
DROP VIEW IF EXISTS trapper.v_place_colony_status CASCADE;

-- Recreate v_place_colony_status with supersession filter
CREATE OR REPLACE VIEW trapper.v_place_colony_status AS
WITH
-- Get verified cat count from database (ground truth)
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

-- Calculate recency-weighted confidence for each ACTIVE estimate
-- Excludes: is_excluded=TRUE, is_superseded=TRUE
-- Incorporates number_confidence for approximate vs exact counts
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
        -- Base confidence from source type (WHO reported)
        COALESCE(sc.base_confidence, 0.50) AS base_confidence,
        -- Number confidence (HOW precise is the count)
        COALESCE(e.number_confidence, cpf.default_number_confidence, 0.80) AS number_confidence,
        -- Supersession tier
        COALESCE(sc.supersession_tier, 1) AS tier,
        -- Days since observation
        EXTRACT(DAY FROM NOW() - COALESCE(e.observation_date::timestamptz, e.reported_at)) AS days_ago,
        -- Recency decay factor
        CASE
            WHEN EXTRACT(DAY FROM NOW() - COALESCE(e.observation_date::timestamptz, e.reported_at)) <= 30
                THEN 1.0
            WHEN EXTRACT(DAY FROM NOW() - COALESCE(e.observation_date::timestamptz, e.reported_at)) <= 90
                THEN 0.90
            WHEN EXTRACT(DAY FROM NOW() - COALESCE(e.observation_date::timestamptz, e.reported_at)) <= 180
                THEN 0.75
            WHEN EXTRACT(DAY FROM NOW() - COALESCE(e.observation_date::timestamptz, e.reported_at)) <= 365
                THEN 0.50
            ELSE 0.25
        END AS recency_factor,
        -- Firsthand bonus
        CASE WHEN e.is_firsthand THEN COALESCE(sc.is_firsthand_boost, 0.05) ELSE 0 END AS firsthand_boost
    FROM trapper.place_colony_estimates e
    LEFT JOIN trapper.colony_source_confidence sc ON sc.source_type = e.source_type
    LEFT JOIN trapper.count_precision_factors cpf ON cpf.precision_type = e.count_precision
    WHERE e.total_cats IS NOT NULL
      AND e.total_cats > 0
      AND (e.is_excluded IS NULL OR e.is_excluded = FALSE)
      AND (e.is_superseded IS NULL OR e.is_superseded = FALSE)  -- NEW: Exclude superseded
),

-- Aggregate estimates per place
aggregated AS (
    SELECT
        place_id,
        -- Weighted estimate using all confidence factors:
        -- source_confidence (WHO) × number_confidence (HOW PRECISE) × recency × firsthand_boost
        ROUND(
            SUM(total_cats * base_confidence * number_confidence * recency_factor * (1 + firsthand_boost))
            / NULLIF(SUM(base_confidence * number_confidence * recency_factor * (1 + firsthand_boost)), 0)
        )::INT AS weighted_estimate,
        -- Also track the single best estimate (highest tier, most recent, firsthand)
        (ARRAY_AGG(total_cats ORDER BY tier DESC, is_firsthand DESC NULLS LAST, observation_date DESC NULLS LAST))[1] AS best_single_estimate,
        -- Min/max across estimates
        MIN(COALESCE(total_cats_min, total_cats)) AS estimate_min,
        MAX(COALESCE(total_cats_max, total_cats)) AS estimate_max,
        -- Demographics
        SUM(adult_count) AS est_adults,
        SUM(kitten_count) AS est_kittens,
        SUM(altered_count) AS est_altered,
        SUM(unaltered_count) AS est_unaltered,
        SUM(friendly_count) AS est_friendly,
        SUM(feral_count) AS est_feral,
        -- Counts
        COUNT(*) AS estimate_count,
        COUNT(*) FILTER (WHERE days_ago <= 90) AS recent_estimate_count,
        -- Confidence metrics (composite of source + number + recency)
        AVG(base_confidence * number_confidence * recency_factor * (1 + firsthand_boost)) AS avg_confidence,
        COUNT(DISTINCT source_type) > 1 AS is_multi_source,
        (ARRAY_AGG(source_type ORDER BY tier DESC, base_confidence * recency_factor DESC))[1] AS primary_source,
        MAX(observation_date) AS latest_observation
    FROM weighted_estimates
    GROUP BY place_id
),

-- Get place metadata and any manual overrides
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
        p.colony_override_by
    FROM trapper.places p
)

SELECT
    COALESCE(pd.place_id, vc.place_id, agg.place_id) AS place_id,
    pd.place_name,
    pd.formatted_address,
    pd.service_zone,
    -- Verified counts (ground truth)
    COALESCE(vc.verified_cat_count, 0) AS verified_cat_count,
    COALESCE(vc.verified_altered_count, 0) AS verified_altered_count,
    vc.last_verified_at,
    -- Raw estimate (before applying GREATEST with verified)
    agg.weighted_estimate AS raw_estimated_total,
    agg.best_single_estimate,
    agg.estimate_min,
    agg.estimate_max,
    -- Effective colony size: GREATEST of verified and estimated
    GREATEST(
        COALESCE(pd.colony_override_count, agg.weighted_estimate, 0),
        COALESCE(vc.verified_cat_count, 0)
    ) AS colony_size_estimate,
    -- Demographics
    agg.est_adults,
    agg.est_kittens,
    agg.est_altered,
    agg.est_unaltered,
    agg.est_friendly,
    agg.est_feral,
    -- Estimate metrics
    COALESCE(agg.estimate_count, 0) AS estimate_count,
    COALESCE(agg.recent_estimate_count, 0) AS recent_estimate_count,
    agg.avg_confidence,
    COALESCE(agg.is_multi_source, FALSE) AS is_multi_source_confirmed,
    -- Final confidence with verified boost
    CASE
        WHEN vc.verified_cat_count > 0 THEN LEAST(1.0, COALESCE(agg.avg_confidence, 0.5) + 0.2)
        ELSE COALESCE(agg.avg_confidence, 0)
    END AS final_confidence,
    agg.primary_source,
    agg.latest_observation,
    -- Work remaining
    GREATEST(0,
        GREATEST(
            COALESCE(pd.colony_override_count, agg.weighted_estimate, 0),
            COALESCE(vc.verified_cat_count, 0)
        ) - COALESCE(vc.verified_altered_count, 0)
    ) AS estimated_work_remaining,
    -- Alteration rate (capped at 100%)
    CASE
        WHEN GREATEST(
            COALESCE(pd.colony_override_count, agg.weighted_estimate, 0),
            COALESCE(vc.verified_cat_count, 0)
        ) > 0
        THEN LEAST(100.0,
            COALESCE(vc.verified_altered_count, 0)::NUMERIC * 100.0 /
            GREATEST(
                COALESCE(pd.colony_override_count, agg.weighted_estimate, 0),
                COALESCE(vc.verified_cat_count, 0)
            )
        )
        ELSE NULL
    END AS alteration_rate_pct,
    -- Override info
    pd.colony_override_count IS NOT NULL AS has_override,
    pd.colony_override_count,
    pd.colony_override_altered,
    pd.colony_override_note,
    pd.colony_override_at,
    pd.colony_override_by,
    -- Estimation method
    CASE
        WHEN pd.colony_override_count IS NOT NULL THEN 'Manual Override'
        WHEN vc.verified_cat_count > COALESCE(agg.weighted_estimate, 0) THEN 'Verified (exceeds estimate)'
        WHEN agg.weighted_estimate IS NOT NULL THEN 'Estimated'
        WHEN vc.verified_cat_count > 0 THEN 'Verified Only'
        ELSE 'No Data'
    END AS estimation_method
FROM place_data pd
FULL OUTER JOIN verified_counts vc ON vc.place_id = pd.place_id
FULL OUTER JOIN aggregated agg ON agg.place_id = COALESCE(pd.place_id, vc.place_id);

COMMENT ON VIEW trapper.v_place_colony_status IS
'Colony status per place with weighted confidence scoring.
Excludes estimates marked as is_excluded=TRUE or is_superseded=TRUE.
Uses supersession model: higher-tier firsthand observations supersede lower-tier guesses.
Combines survey data, verified cats, and multi-source confirmation.';

-- ============================================================
-- 6. Apply supersession to existing data
-- ============================================================

\echo ''
\echo 'Applying supersession to existing estimates...'

-- For each place with multiple estimates, apply supersession
WITH places_with_estimates AS (
    SELECT DISTINCT place_id
    FROM trapper.place_colony_estimates
    WHERE total_cats IS NOT NULL
      AND (is_excluded IS NULL OR is_excluded = FALSE)
)
SELECT
    p.place_id,
    (trapper.apply_estimate_supersession(p.place_id)).superseded_count
FROM places_with_estimates p;

-- Show results for the specific place mentioned by user
\echo ''
\echo 'Checking supersession for Laura Martinez place:'

SELECT
  e.estimate_id,
  e.source_type,
  e.total_cats,
  e.is_firsthand,
  e.is_superseded,
  e.supersession_reason,
  sc.supersession_tier
FROM trapper.place_colony_estimates e
LEFT JOIN trapper.colony_source_confidence sc ON sc.source_type = e.source_type
WHERE e.place_id = '5b300dfa-6dda-44b1-a277-53a69254d75d'
ORDER BY e.observation_date DESC NULLS LAST;

-- ============================================================
-- 7. Recreate dependent views
-- ============================================================

\echo ''
\echo 'Recreating dependent views...'

-- v_request_colony_summary
CREATE OR REPLACE VIEW trapper.v_request_colony_summary AS
SELECT
    r.request_id,
    r.place_id,
    r.summary AS request_summary,
    r.status::TEXT AS request_status,
    r.estimated_cat_count AS request_estimated_cats,
    r.total_cats_reported,
    r.cat_count_semantic::TEXT,
    -- Place info
    pcs.place_name,
    pcs.formatted_address AS place_address,
    pcs.service_zone AS place_zone,
    -- Verified counts
    pcs.verified_cat_count AS place_verified_cats,
    pcs.verified_altered_count AS place_verified_altered,
    -- Colony estimates
    pcs.colony_size_estimate AS place_colony_size,
    pcs.estimated_work_remaining AS place_work_remaining,
    pcs.alteration_rate_pct AS place_alteration_rate,
    pcs.has_override,
    pcs.colony_override_count,
    pcs.colony_override_altered,
    pcs.colony_override_note,
    -- Effective remaining (considering request-specific data)
    GREATEST(0,
        COALESCE(pcs.colony_size_estimate, r.estimated_cat_count, 0)
        - COALESCE(pcs.verified_altered_count, 0)
    ) AS effective_remaining,
    -- Flag if verified > reported (needs reconciliation)
    pcs.verified_altered_count > COALESCE(r.total_cats_reported, r.estimated_cat_count, 0)
        AND r.total_cats_reported IS NOT NULL AS verified_exceeds_reported,
    pcs.estimation_method
FROM trapper.sot_requests r
LEFT JOIN trapper.v_place_colony_status pcs ON pcs.place_id = r.place_id
WHERE r.place_id IS NOT NULL;

\echo ''
\echo '=== MIG_612 Complete ==='
\echo ''
\echo 'Supersession model implemented:'
\echo '  - Tier 3 (trapper observations) supersedes Tier 1 (requester guesses)'
\echo '  - Superseded estimates remain for history but excluded from aggregation'
\echo '  - Auto-triggers on new firsthand observations'
\echo '  - Scientifically defensible: follows Bayesian updating principles'
\echo ''
