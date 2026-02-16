-- MIG_2311: Add verification columns to people/cats and create colony status view
--
-- Purpose: Enable staff verification workflow for all core entities
-- V2 Architecture: Verification is a data quality signal (INV-2: Manual > AI)

-- ============================================================
-- PART 1: People Verification
-- ============================================================

ALTER TABLE sot.people
  ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS verified_by TEXT;

CREATE INDEX IF NOT EXISTS idx_people_unverified
  ON sot.people (verified_at)
  WHERE verified_at IS NULL;

-- ============================================================
-- PART 2: Cats Verification
-- ============================================================

ALTER TABLE sot.cats
  ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS verified_by TEXT;

CREATE INDEX IF NOT EXISTS idx_cats_unverified
  ON sot.cats (verified_at)
  WHERE verified_at IS NULL;

-- ============================================================
-- PART 3: Place Colony Status View
-- ============================================================

-- Drop existing view to allow column name changes
DROP VIEW IF EXISTS sot.v_place_colony_status CASCADE;

-- This view provides colony-related statistics for places
-- Used by the requests detail page to show place context
-- Column names match what the API expects
CREATE OR REPLACE VIEW sot.v_place_colony_status AS
SELECT
  p.place_id,
  p.display_name,
  p.formatted_address,
  -- Colony estimate from place_colony_estimates (most recent)
  pce.estimated_count AS colony_size_estimate,
  pce.estimation_method,
  pce.confidence AS estimate_confidence,
  pce.estimated_at,
  -- Cat counts from relationships
  COALESCE(cc.total_cats, 0) AS total_cats,
  COALESCE(cc.altered_cats, 0) AS verified_altered_count,
  -- Calculate work remaining (estimate - altered)
  GREATEST(0, COALESCE(pce.estimated_count, cc.total_cats, 0) - COALESCE(cc.altered_cats, 0)) AS estimated_work_remaining,
  -- Calculate alteration rate
  CASE
    WHEN COALESCE(cc.total_cats, 0) > 0
    THEN ROUND((COALESCE(cc.altered_cats, 0)::numeric / cc.total_cats) * 100, 1)
    ELSE 0
  END AS alteration_rate_pct,
  -- Override tracking (from place_colony_estimates)
  pce.has_override,
  pce.override_note AS colony_override_note,
  -- Active request count
  COALESCE(req.active_count, 0) AS active_request_count,
  -- Context flags
  EXISTS(
    SELECT 1 FROM sot.place_contexts pc
    WHERE pc.place_id = p.place_id
      AND pc.context_type IN ('colony', 'colony_site', 'feeding_station')
      AND pc.valid_to IS NULL
  ) AS is_colony_site
FROM sot.places p
LEFT JOIN LATERAL (
  SELECT
    COALESCE(chapman_estimate, total_count_observed) AS estimated_count,
    estimate_method AS estimation_method,
    1.0 AS confidence,
    observed_date AS estimated_at,
    FALSE AS has_override,  -- V2: No override tracking yet
    observer_notes AS override_note
  FROM sot.place_colony_estimates
  WHERE place_id = p.place_id
  ORDER BY observed_date DESC
  LIMIT 1
) pce ON TRUE
LEFT JOIN LATERAL (
  SELECT
    COUNT(DISTINCT cp.cat_id) AS total_cats,
    COUNT(DISTINCT cp.cat_id) FILTER (
      WHERE EXISTS(
        SELECT 1 FROM ops.cat_procedures proc
        WHERE proc.cat_id = cp.cat_id AND (proc.is_spay OR proc.is_neuter)
      )
    ) AS altered_cats
  FROM sot.cat_place cp
  JOIN sot.cats c ON c.cat_id = cp.cat_id AND c.merged_into_cat_id IS NULL
  WHERE cp.place_id = p.place_id
) cc ON TRUE
LEFT JOIN LATERAL (
  SELECT COUNT(*) AS active_count
  FROM ops.requests r
  WHERE r.place_id = p.place_id
    AND r.status IN ('new', 'triaged', 'scheduled', 'in_progress')
) req ON TRUE
WHERE p.merged_into_place_id IS NULL;

-- ============================================================
-- VERIFICATION
-- ============================================================

DO $$
DECLARE
  v_people_cols TEXT[];
  v_cats_cols TEXT[];
BEGIN
  SELECT array_agg(column_name) INTO v_people_cols
  FROM information_schema.columns
  WHERE table_schema = 'sot' AND table_name = 'people';

  SELECT array_agg(column_name) INTO v_cats_cols
  FROM information_schema.columns
  WHERE table_schema = 'sot' AND table_name = 'cats';

  ASSERT 'verified_at' = ANY(v_people_cols), 'Missing verified_at on people';
  ASSERT 'verified_by' = ANY(v_people_cols), 'Missing verified_by on people';
  ASSERT 'verified_at' = ANY(v_cats_cols), 'Missing verified_at on cats';
  ASSERT 'verified_by' = ANY(v_cats_cols), 'Missing verified_by on cats';

  RAISE NOTICE 'MIG_2311: Verification columns added to people and cats';
  RAISE NOTICE 'MIG_2311: v_place_colony_status view created';
END;
$$;
