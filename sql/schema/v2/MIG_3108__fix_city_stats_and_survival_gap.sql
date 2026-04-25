-- MIG_3108: Fix missing mv_city_stats + ShelterLuv survival gap
--
-- BUG 1: ops.mv_city_stats and ops.mv_ffr_impact_summary don't exist.
--   area_stats tool references them → silently fails → Sonnet falls back to
--   14 run_sql calls for city comparisons. Create them as regular views.
--
-- BUG 2: ops.estimate_living_altered_cats() only counts cats with appointment_date.
--   1,649 ShelterLuv program animals (altered via foster/adoption) have no
--   appointment_date → missing from survival estimate. Fix: include cats
--   using created_at as fallback date.

-- ============================================================================
-- 1. Create ops.mv_city_stats (regular view, not materialized)
-- ============================================================================

CREATE OR REPLACE VIEW ops.mv_city_stats AS
SELECT
  COALESCE(a.city, 'Unknown') AS city,
  COUNT(DISTINCT p.place_id)::INT AS total_places,
  COUNT(DISTINCT cp.cat_id)::INT AS total_cats,
  COUNT(DISTINCT cp.cat_id) FILTER (
    WHERE c.altered_status IN ('spayed','neutered','altered','Yes')
  )::INT AS altered_cats,
  COUNT(DISTINCT cp.cat_id) FILTER (
    WHERE c.altered_status IN ('intact','No')
  )::INT AS intact_cats,
  COUNT(DISTINCT cp.cat_id) FILTER (
    WHERE c.altered_status IS NULL
      OR c.altered_status NOT IN ('spayed','neutered','altered','Yes','intact','No')
  )::INT AS unknown_status_cats,
  (SELECT COUNT(*) FROM ops.requests r
   WHERE r.place_id = ANY(ARRAY_AGG(p.place_id))
     AND r.merged_into_request_id IS NULL
  )::INT AS total_requests,
  (SELECT COUNT(*) FROM ops.requests r
   WHERE r.place_id = ANY(ARRAY_AGG(p.place_id))
     AND r.merged_into_request_id IS NULL
     AND r.status = 'completed'
  )::INT AS completed_requests,
  (SELECT COUNT(*) FROM ops.requests r
   WHERE r.place_id = ANY(ARRAY_AGG(p.place_id))
     AND r.merged_into_request_id IS NULL
     AND r.status NOT IN ('completed','cancelled')
  )::INT AS active_requests
FROM sot.places p
JOIN sot.addresses a ON a.address_id = p.sot_address_id
LEFT JOIN sot.cat_place cp ON cp.place_id = p.place_id
  AND COALESCE(cp.presence_status, 'unknown') != 'departed'
LEFT JOIN sot.cats c ON c.cat_id = cp.cat_id AND c.merged_into_cat_id IS NULL
WHERE p.merged_into_place_id IS NULL
  AND a.city IS NOT NULL
GROUP BY a.city;

COMMENT ON VIEW ops.mv_city_stats IS
  'City-level cat/place/request stats. Used by area_stats tool. Named mv_ for backwards compat with tool code.';

-- ============================================================================
-- 2. Create ops.mv_ffr_impact_summary
-- ============================================================================

CREATE OR REPLACE VIEW ops.mv_ffr_impact_summary AS
SELECT
  COALESCE(addr.city, 'Unknown') AS city,
  COUNT(DISTINCT ap.cat_id)::INT AS unique_cats_seen,
  COUNT(DISTINCT ap.cat_id) FILTER (
    WHERE c.altered_status IN ('spayed','neutered','altered','Yes')
  )::INT AS cats_altered,
  COUNT(DISTINCT ap.place_id)::INT AS places_served,
  COUNT(*)::INT AS total_appointments
FROM ops.appointments ap
JOIN sot.cats c ON c.cat_id = ap.cat_id AND c.merged_into_cat_id IS NULL
LEFT JOIN sot.places p ON p.place_id = ap.place_id AND p.merged_into_place_id IS NULL
LEFT JOIN sot.addresses addr ON addr.address_id = p.sot_address_id
WHERE ap.appointment_date IS NOT NULL
GROUP BY COALESCE(addr.city, 'Unknown');

COMMENT ON VIEW ops.mv_ffr_impact_summary IS
  'City-level FFR impact metrics. Used by area_stats tool. Named mv_ for backwards compat.';

-- ============================================================================
-- 3. Fix survival estimate to include ShelterLuv cats without appointments
-- ============================================================================

CREATE OR REPLACE FUNCTION ops.estimate_living_altered_cats(
  p_attrition_rate NUMERIC DEFAULT NULL,
  p_max_years INT DEFAULT 15
)
RETURNS TABLE (
  year INT,
  cats_altered INT,
  years_elapsed INT,
  attrition_rate NUMERIC,
  estimated_living INT
)
LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_rate NUMERIC;
BEGIN
  IF p_attrition_rate IS NOT NULL THEN
    v_rate := p_attrition_rate;
  ELSE
    SELECT COALESCE((ac.value)::NUMERIC, 0.13)
    INTO v_rate
    FROM ops.app_config ac
    WHERE ac.key = 'survival.annual_attrition_managed';

    IF v_rate IS NULL THEN
      v_rate := 0.13;
    END IF;
  END IF;

  RETURN QUERY
  SELECT
    cohort.yr::INT AS year,
    cohort.cnt::INT AS cats_altered,
    (EXTRACT(YEAR FROM NOW()) - cohort.yr)::INT AS years_elapsed,
    v_rate AS attrition_rate,
    ROUND(cohort.cnt * POWER(1 - v_rate, EXTRACT(YEAR FROM NOW()) - cohort.yr))::INT AS estimated_living
  FROM (
    -- Union: cats with appointment dates + cats without (ShelterLuv program animals)
    SELECT yr, SUM(cnt) AS cnt FROM (
      -- Cats with appointment dates (majority)
      SELECT
        EXTRACT(YEAR FROM a.appointment_date) AS yr,
        COUNT(DISTINCT a.cat_id) AS cnt
      FROM ops.appointments a
      JOIN sot.cats c ON c.cat_id = a.cat_id
        AND c.merged_into_cat_id IS NULL
        AND COALESCE(c.is_deceased, FALSE) = FALSE
        AND c.altered_status IN ('spayed','neutered','altered','Yes')
      WHERE a.appointment_date IS NOT NULL
        AND EXTRACT(YEAR FROM a.appointment_date) >= EXTRACT(YEAR FROM NOW()) - p_max_years
      GROUP BY 1

      UNION ALL

      -- Cats without appointments (ShelterLuv program animals) — use created_at
      SELECT
        EXTRACT(YEAR FROM c.created_at) AS yr,
        COUNT(*) AS cnt
      FROM sot.cats c
      WHERE c.merged_into_cat_id IS NULL
        AND COALESCE(c.is_deceased, FALSE) = FALSE
        AND c.altered_status IN ('spayed','neutered','altered','Yes')
        AND NOT EXISTS (
          SELECT 1 FROM ops.appointments a
          WHERE a.cat_id = c.cat_id AND a.appointment_date IS NOT NULL
        )
        AND EXTRACT(YEAR FROM c.created_at) >= EXTRACT(YEAR FROM NOW()) - p_max_years
      GROUP BY 1
    ) combined
    GROUP BY yr
  ) cohort
  ORDER BY cohort.yr;
END;
$$;

-- ============================================================================
-- Verify
-- ============================================================================
-- SELECT city, total_cats, altered_cats, intact_cats FROM ops.mv_city_stats WHERE city IN ('Santa Rosa','Petaluma');
-- SELECT city, cats_altered, places_served FROM ops.mv_ffr_impact_summary WHERE city IN ('Santa Rosa','Petaluma');
-- SELECT SUM(estimated_living) FROM ops.estimate_living_altered_cats();  -- should be ~20,491 now
