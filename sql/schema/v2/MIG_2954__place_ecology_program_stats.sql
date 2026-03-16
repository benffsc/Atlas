-- MIG_2954: Place ecology stats + program quarterly views (FFS-587)
--
-- Missing views used by:
--   /api/places/[id]/colony-estimates — sot.v_place_ecology_stats
--   /api/health/program-stats — ops.v_foster_program_quarterly,
--     ops.v_county_cat_quarterly, ops.v_lmfm_quarterly,
--     ops.v_program_comparison_quarterly
--
-- Also adds colony columns to sot.places used by colony-estimates route.

BEGIN;

-- ── Colony columns on sot.places ────────────────────────────────────────

ALTER TABLE sot.places
  ADD COLUMN IF NOT EXISTS colony_size_estimate INT,
  ADD COLUMN IF NOT EXISTS colony_confidence NUMERIC(3,2),
  ADD COLUMN IF NOT EXISTS colony_estimate_count INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS colony_updated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS colony_classification TEXT,
  ADD COLUMN IF NOT EXISTS colony_classification_reason TEXT,
  ADD COLUMN IF NOT EXISTS colony_classification_set_by TEXT,
  ADD COLUMN IF NOT EXISTS colony_classification_set_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS authoritative_cat_count INT,
  ADD COLUMN IF NOT EXISTS authoritative_count_reason TEXT,
  ADD COLUMN IF NOT EXISTS allows_clustering BOOLEAN DEFAULT TRUE;

-- ── View: v_place_ecology_stats ─────────────────────────────────────────

CREATE OR REPLACE VIEW sot.v_place_ecology_stats AS
WITH cat_counts AS (
  SELECT
    cp.place_id,
    COUNT(DISTINCT cp.cat_id)::INT AS a_known,
    COUNT(DISTINCT cp.cat_id) FILTER (
      WHERE cp.relationship_type IN ('home', 'residence', 'colony_member')
    )::INT AS a_known_current,
    COUNT(DISTINCT cp.cat_id) FILTER (
      WHERE cp.relationship_type IN ('home', 'residence', 'colony_member', 'seen_at')
    )::INT AS a_known_effective,
    COUNT(DISTINCT cp.cat_id) FILTER (
      WHERE c.altered_status NOT IN ('spayed', 'neutered', 'altered')
        AND cp.relationship_type IN ('home', 'residence', 'colony_member')
    )::INT AS cats_needing_tnr,
    COUNT(DISTINCT cp.cat_id) FILTER (
      WHERE c.altered_status IN ('spayed', 'neutered', 'altered')
        AND cp.relationship_type IN ('home', 'residence', 'colony_member')
    )::INT AS altered_count,
    COUNT(DISTINCT cp.cat_id) FILTER (
      WHERE c.ear_tip IS NOT NULL AND c.ear_tip != ''
        AND cp.relationship_type IN ('home', 'residence', 'colony_member')
    )::INT AS eartip_count
  FROM sot.cat_place cp
  JOIN sot.cats c ON c.cat_id = cp.cat_id AND c.merged_into_cat_id IS NULL
  GROUP BY cp.place_id
),
observations AS (
  SELECT
    pce.place_id,
    MAX(pce.total_count_observed)::INT AS n_recent_max,
    BOOL_OR(pce.eartip_count_observed IS NOT NULL AND pce.eartip_count_observed > 0) AS has_eartip_data,
    SUM(COALESCE(pce.eartip_count_observed, 0))::INT AS total_eartips_seen,
    SUM(COALESCE(pce.total_count_observed, 0))::INT AS total_cats_seen,
    -- Chapman mark-recapture: N = ((M+1)(C+1)/(R+1)) - 1
    -- M = marked (eartipped cats known), C = total seen, R = eartipped seen
    CASE
      WHEN MAX(pce.eartip_count_observed) > 0
           AND MAX(pce.total_count_observed) > 0
      THEN ROUND(
        ((MAX(cc.eartip_count) + 1.0) * (MAX(pce.total_count_observed) + 1.0))
        / (MAX(pce.eartip_count_observed) + 1.0) - 1
      )
    END AS n_hat_chapman
  FROM sot.place_colony_estimates pce
  LEFT JOIN cat_counts cc ON cc.place_id = pce.place_id
  GROUP BY pce.place_id
)
SELECT
  p.place_id,
  COALESCE(cc.a_known, 0) AS a_known,
  COALESCE(cc.a_known_current, 0) AS a_known_current,
  COALESCE(cc.a_known_effective, 0) AS a_known_effective,
  COALESCE(cc.cats_needing_tnr, 0) AS cats_needing_tnr,
  COALESCE(obs.n_recent_max, 0) AS n_recent_max,
  -- Proportion altered (lower bound estimate)
  CASE
    WHEN COALESCE(cc.a_known_current, 0) > 0
    THEN ROUND(cc.altered_count::NUMERIC / cc.a_known_current, 3)
  END AS p_lower,
  CASE
    WHEN COALESCE(cc.a_known_current, 0) > 0
    THEN ROUND(cc.altered_count::NUMERIC / cc.a_known_current * 100, 1)
  END AS p_lower_pct,
  -- Estimation method
  CASE
    WHEN obs.n_hat_chapman IS NOT NULL THEN 'chapman_mark_recapture'
    WHEN COALESCE(obs.n_recent_max, 0) > 0 THEN 'observation_max'
    WHEN COALESCE(cc.a_known_current, 0) > 0 THEN 'verified_cats_only'
    ELSE 'no_data'
  END AS estimation_method,
  COALESCE(obs.has_eartip_data, FALSE) AS has_eartip_data,
  COALESCE(obs.total_eartips_seen, 0) AS total_eartips_seen,
  COALESCE(obs.total_cats_seen, 0) AS total_cats_seen,
  obs.n_hat_chapman,
  CASE
    WHEN obs.n_hat_chapman IS NOT NULL AND obs.n_hat_chapman > 0
    THEN ROUND(cc.altered_count::NUMERIC / obs.n_hat_chapman * 100, 1)
  END AS p_hat_chapman_pct,
  -- Best colony estimate: Chapman if available, else observation max, else known cats
  COALESCE(obs.n_hat_chapman, obs.n_recent_max, cc.a_known_current)::INT AS best_colony_estimate,
  -- Estimated work remaining
  GREATEST(
    COALESCE(obs.n_hat_chapman, obs.n_recent_max, cc.a_known_current, 0) - COALESCE(cc.altered_count, 0),
    0
  )::INT AS estimated_work_remaining
FROM sot.places p
LEFT JOIN cat_counts cc ON cc.place_id = p.place_id
LEFT JOIN observations obs ON obs.place_id = p.place_id
WHERE p.merged_into_place_id IS NULL
  AND (cc.a_known IS NOT NULL OR obs.n_recent_max IS NOT NULL);

COMMENT ON VIEW sot.v_place_ecology_stats IS 'Place-level ecological metrics with Chapman mark-recapture estimation (ported from V1)';

-- ── Program quarterly views ─────────────────────────────────────────────
-- Based on ops.appointments.appointment_source_category (from MIG_2950)

CREATE OR REPLACE VIEW ops.v_foster_program_quarterly AS
SELECT
  EXTRACT(YEAR FROM a.appointment_date)::INT AS year,
  EXTRACT(QUARTER FROM a.appointment_date)::INT AS quarter,
  'Q' || EXTRACT(QUARTER FROM a.appointment_date)::TEXT || ' ' ||
    EXTRACT(YEAR FROM a.appointment_date)::TEXT AS quarter_label,
  COUNT(DISTINCT a.cat_id)::INT AS total_cats,
  COUNT(*)::INT AS total_alterations
FROM ops.appointments a
WHERE a.appointment_source_category = 'foster_program'
  AND a.appointment_date IS NOT NULL
GROUP BY 1, 2, 3
ORDER BY 1 DESC, 2 DESC;

COMMENT ON VIEW ops.v_foster_program_quarterly IS 'Foster program quarterly alteration stats';

CREATE OR REPLACE VIEW ops.v_county_cat_quarterly AS
SELECT
  EXTRACT(YEAR FROM a.appointment_date)::INT AS year,
  EXTRACT(QUARTER FROM a.appointment_date)::INT AS quarter,
  'Q' || EXTRACT(QUARTER FROM a.appointment_date)::TEXT || ' ' ||
    EXTRACT(YEAR FROM a.appointment_date)::TEXT AS quarter_label,
  COUNT(DISTINCT a.cat_id)::INT AS total_cats,
  COUNT(*)::INT AS total_alterations
FROM ops.appointments a
WHERE a.appointment_source_category = 'county_scas'
  AND a.appointment_date IS NOT NULL
GROUP BY 1, 2, 3
ORDER BY 1 DESC, 2 DESC;

COMMENT ON VIEW ops.v_county_cat_quarterly IS 'County SCAS quarterly alteration stats';

CREATE OR REPLACE VIEW ops.v_lmfm_quarterly AS
SELECT
  EXTRACT(YEAR FROM a.appointment_date)::INT AS year,
  EXTRACT(QUARTER FROM a.appointment_date)::INT AS quarter,
  'Q' || EXTRACT(QUARTER FROM a.appointment_date)::TEXT || ' ' ||
    EXTRACT(YEAR FROM a.appointment_date)::TEXT AS quarter_label,
  COUNT(DISTINCT a.cat_id)::INT AS total_cats,
  COUNT(*)::INT AS total_alterations
FROM ops.appointments a
WHERE a.appointment_source_category = 'lmfm'
  AND a.appointment_date IS NOT NULL
GROUP BY 1, 2, 3
ORDER BY 1 DESC, 2 DESC;

COMMENT ON VIEW ops.v_lmfm_quarterly IS 'LMFM quarterly alteration stats';

CREATE OR REPLACE VIEW ops.v_program_comparison_quarterly AS
SELECT
  EXTRACT(YEAR FROM a.appointment_date)::INT AS year,
  EXTRACT(QUARTER FROM a.appointment_date)::INT AS quarter,
  'Q' || EXTRACT(QUARTER FROM a.appointment_date)::TEXT || ' ' ||
    EXTRACT(YEAR FROM a.appointment_date)::TEXT AS quarter_label,
  COUNT(*) FILTER (WHERE a.appointment_source_category = 'foster_program')::INT AS foster_alterations,
  COUNT(*) FILTER (WHERE a.appointment_source_category = 'county_scas')::INT AS county_alterations,
  COUNT(*) FILTER (WHERE a.appointment_source_category = 'lmfm')::INT AS lmfm_alterations,
  COUNT(*)::INT AS total_alterations,
  ROUND(
    COUNT(*) FILTER (WHERE a.appointment_source_category = 'foster_program')::NUMERIC
    / NULLIF(COUNT(*), 0) * 100, 1
  ) AS foster_pct,
  ROUND(
    COUNT(*) FILTER (WHERE a.appointment_source_category = 'county_scas')::NUMERIC
    / NULLIF(COUNT(*), 0) * 100, 1
  ) AS county_pct,
  ROUND(
    COUNT(*) FILTER (WHERE a.appointment_source_category = 'lmfm')::NUMERIC
    / NULLIF(COUNT(*), 0) * 100, 1
  ) AS lmfm_pct
FROM ops.appointments a
WHERE a.appointment_source_category IS NOT NULL
  AND a.appointment_date IS NOT NULL
GROUP BY 1, 2, 3
ORDER BY 1 DESC, 2 DESC;

COMMENT ON VIEW ops.v_program_comparison_quarterly IS 'Cross-program quarterly comparison stats';

-- ── Backfill colony columns on places from estimates ────────────────────

UPDATE sot.places p
SET
  colony_size_estimate = sub.best_estimate,
  colony_estimate_count = sub.estimate_count,
  colony_updated_at = sub.last_observed
FROM (
  SELECT
    pce.place_id,
    MAX(pce.total_count_observed)::INT AS best_estimate,
    COUNT(*)::INT AS estimate_count,
    MAX(pce.observed_date) AS last_observed
  FROM sot.place_colony_estimates pce
  GROUP BY pce.place_id
) sub
WHERE p.place_id = sub.place_id
  AND p.colony_size_estimate IS NULL;

COMMIT;
