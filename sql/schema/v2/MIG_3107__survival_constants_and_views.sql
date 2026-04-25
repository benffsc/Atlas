-- MIG_3107: Survival estimation constants + analytical views
--
-- Seeds ops.app_config with peer-reviewed survival defaults (configurable).
-- Creates ops.estimate_living_altered_cats() function.
-- Creates ops.v_altered_cat_survival_estimate and ops.v_impact_at_a_glance views.
--
-- All values are stopgap defaults from published research. Staff can update
-- via ops.app_config and everything recalculates — no redeploy needed.
--
-- Addresses: FFS-1388, FFS-1389

-- ============================================================================
-- 1. Seed survival constants in ops.app_config
-- ============================================================================

INSERT INTO ops.app_config (key, value, description, category)
VALUES
  ('survival.annual_attrition_managed', '0.13',
   'Annual attrition rate for managed/TNR colonies. PLOS model range 10-25%. Stopgap default — update when Beacon has FFSC-specific mortality data.',
   'population'),
  ('survival.annual_attrition_unmanaged', '0.25',
   'Annual attrition rate for unmanaged colonies. Higher end of published range.',
   'population'),
  ('survival.managed_colony_lifespan_years', '8',
   'Expected lifespan for managed colony cats. UF 11-year study: 83% alive after 6+ years. Alley Cat Allies: 7-10 years.',
   'population'),
  ('survival.kitten_mortality_rate', '0.75',
   'Kitten mortality rate (first 6 months). 75% from multiple published studies.',
   'population'),
  ('survival.sterilized_health_note', '"Sterilized cats have infection rates comparable to indoor pets (Feline Research org)"',
   'Contextual note for Tippy to cite. Not computational.',
   'population')
ON CONFLICT (key) DO NOTHING;

-- ============================================================================
-- 2. Survival estimation function
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
  -- Use provided rate, or read from app_config, or fall back to 0.13
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
  ) cohort
  ORDER BY cohort.yr;
END;
$$;

COMMENT ON FUNCTION ops.estimate_living_altered_cats IS
  'Cohort-based survival estimation. Uses configurable attrition rate from ops.app_config. '
  'Pass p_attrition_rate to override (e.g., Beacon scenario comparison). '
  'Excludes cats marked is_deceased=TRUE.';

-- ============================================================================
-- 3. Survival estimate view
-- ============================================================================

CREATE OR REPLACE VIEW ops.v_altered_cat_survival_estimate AS
WITH survival AS (
  SELECT * FROM ops.estimate_living_altered_cats()
),
deceased_stats AS (
  SELECT
    COUNT(*) FILTER (WHERE is_deceased = TRUE) AS confirmed_deceased,
    COUNT(*) FILTER (WHERE altered_status IN ('spayed','neutered','altered','Yes')) AS total_altered_ever
  FROM sot.cats
  WHERE merged_into_cat_id IS NULL
)
SELECT
  s.year,
  s.cats_altered,
  s.years_elapsed,
  s.attrition_rate,
  s.estimated_living,
  -- Methodology columns — Tippy must disclose these
  s.attrition_rate || ' annual attrition (peer-reviewed default, configurable in ops.app_config)' AS methodology,
  'Only ' || d.confirmed_deceased || ' of ' || d.total_altered_ever
    || '+ altered cats have confirmed deceased status — most mortality is untracked' AS data_caveat
FROM survival s
CROSS JOIN deceased_stats d;

COMMENT ON VIEW ops.v_altered_cat_survival_estimate IS
  'Year-by-year cohort survival estimate for altered cats. '
  'Includes methodology and data_caveat columns for mandatory Tippy disclosure. '
  'SUM(estimated_living) = total estimated living altered cats.';

-- ============================================================================
-- 4. Impact at a glance (single-row dashboard)
-- ============================================================================

CREATE OR REPLACE VIEW ops.v_impact_at_a_glance AS
SELECT
  (SELECT COUNT(DISTINCT cat_id) FROM ops.appointments
   WHERE appointment_date IS NOT NULL) AS total_cats_seen,
  (SELECT COUNT(*) FROM sot.cats
   WHERE merged_into_cat_id IS NULL
     AND altered_status IN ('spayed','neutered','altered','Yes')) AS total_altered,
  (SELECT SUM(estimated_living) FROM ops.estimate_living_altered_cats()) AS estimated_living,
  (SELECT COUNT(*) FROM sot.places
   WHERE merged_into_place_id IS NULL
     AND EXISTS (SELECT 1 FROM sot.cat_place cp WHERE cp.place_id = places.place_id)) AS places_with_cats,
  (SELECT COUNT(*) FROM ops.requests
   WHERE merged_into_request_id IS NULL
     AND status NOT IN ('completed','cancelled')) AS active_requests,
  (SELECT COUNT(DISTINCT a.city) FROM sot.places p
   JOIN sot.addresses a ON a.address_id = p.sot_address_id
   WHERE p.merged_into_place_id IS NULL AND a.city IS NOT NULL) AS cities_covered,
  (SELECT (ac.value)::NUMERIC FROM ops.app_config ac
   WHERE ac.key = 'survival.annual_attrition_managed') AS attrition_rate_used,
  'Estimated living uses ' ||
    (SELECT (ac.value)::TEXT FROM ops.app_config ac WHERE ac.key = 'survival.annual_attrition_managed') ||
    ' annual attrition (configurable). Only ' ||
    (SELECT COUNT(*) FROM sot.cats WHERE merged_into_cat_id IS NULL AND is_deceased = TRUE) ||
    ' cats have confirmed deceased status.' AS methodology;

COMMENT ON VIEW ops.v_impact_at_a_glance IS
  'Single-row org impact summary. Includes estimated_living (survival model) with methodology disclosure.';

-- ============================================================================
-- 5. Annual impact summary by city
-- ============================================================================

CREATE OR REPLACE VIEW ops.v_annual_impact_summary AS
SELECT
  EXTRACT(YEAR FROM a.appointment_date)::INT AS year,
  COALESCE(addr.city, 'Unknown') AS city,
  COUNT(DISTINCT a.cat_id) AS cats_altered,
  COUNT(DISTINCT a.cat_id) FILTER (WHERE c.sex = 'Female') AS females,
  COUNT(DISTINCT a.cat_id) FILTER (WHERE c.sex = 'Male') AS males,
  COUNT(DISTINCT a.place_id) AS places_served
FROM ops.appointments a
JOIN sot.cats c ON c.cat_id = a.cat_id AND c.merged_into_cat_id IS NULL
  AND c.altered_status IN ('spayed','neutered','altered','Yes')
LEFT JOIN sot.places p ON p.place_id = a.place_id AND p.merged_into_place_id IS NULL
LEFT JOIN sot.addresses addr ON addr.address_id = p.sot_address_id
WHERE a.appointment_date IS NOT NULL
GROUP BY 1, 2
ORDER BY 1 DESC, 3 DESC;

COMMENT ON VIEW ops.v_annual_impact_summary IS
  'Yearly alteration counts by city and sex. For trend analysis and city comparison.';

-- ============================================================================
-- Verify
-- ============================================================================
-- SELECT * FROM ops.estimate_living_altered_cats();
-- SELECT * FROM ops.estimate_living_altered_cats(0.10);  -- scenario: 10% attrition
-- SELECT SUM(estimated_living) AS total_living FROM ops.v_altered_cat_survival_estimate;
-- SELECT * FROM ops.v_impact_at_a_glance;
-- SELECT * FROM ops.v_annual_impact_summary WHERE city = 'Santa Rosa' LIMIT 5;
