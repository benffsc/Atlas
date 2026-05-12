-- MIG_3136: Sex-aware economic impact SQL functions
--
-- Core computation functions for the v2 economic impact model:
--   1. ops.compute_kittens_prevented(cats_altered) → 3 confidence tiers
--   2. ops.compute_economic_impact(cats_altered) → cost breakdown × 3 tiers
--   3. ops.v_economic_impact_summary → single-row org-wide view
--   4. ops.v_economic_impact_by_city → per-city using PostGIS spatial join
--
-- All parameters read from ops.app_config (MIG_3135) with sensible defaults.
-- Functions are STABLE — safe for views and repeated calls.
--
-- Depends: MIG_3135 (config seeds), MIG_3133 (city_boundaries table)

-- ============================================================================
-- 1. Kittens prevented (sex-aware, 3 tiers)
-- ============================================================================

CREATE OR REPLACE FUNCTION ops.compute_kittens_prevented(
  p_cats_altered INT,
  p_female_count INT DEFAULT NULL,
  p_male_count INT DEFAULT NULL
)
RETURNS TABLE (
  tier TEXT,
  kittens_prevented NUMERIC,
  methodology TEXT
)
LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_female_ratio NUMERIC;
  v_litters_per_year NUMERIC;
  v_kittens_per_litter NUMERIC;
  v_survival_rate NUMERIC;
  v_reproductive_years NUMERIC;
  v_male_pregnancies_prevented NUMERIC;
  v_conf_conservative NUMERIC;
  v_conf_moderate NUMERIC;
  v_conf_high NUMERIC;
  v_females INT;
  v_males INT;
  v_female_kittens NUMERIC;
  v_male_kittens NUMERIC;
  v_moderate_total NUMERIC;
  v_method TEXT;
BEGIN
  -- Read config with defaults
  v_female_ratio := ops.get_config_numeric('impact.female_ratio', 0.50);
  v_litters_per_year := ops.get_config_numeric('impact.litters_per_year_per_female', 2.5);
  v_kittens_per_litter := ops.get_config_numeric('impact.kittens_per_litter', 4.0);
  v_survival_rate := ops.get_config_numeric('impact.kitten_survival_rate', 0.25);
  v_reproductive_years := ops.get_config_numeric('impact.reproductive_years', 5);
  v_male_pregnancies_prevented := ops.get_config_numeric('impact.male_pregnancies_prevented_per_year', 3.0);
  v_conf_conservative := ops.get_config_numeric('impact.confidence_conservative_multiplier', 0.6);
  v_conf_moderate := ops.get_config_numeric('impact.confidence_moderate_multiplier', 1.0);
  v_conf_high := ops.get_config_numeric('impact.confidence_high_multiplier', 1.8);

  -- Use actual sex counts if provided, otherwise estimate from ratio
  IF p_female_count IS NOT NULL AND p_male_count IS NOT NULL THEN
    v_females := p_female_count;
    v_males := p_male_count;
  ELSE
    v_females := ROUND(p_cats_altered * v_female_ratio);
    v_males := p_cats_altered - v_females;
  END IF;

  -- Female impact: each spayed female prevents her own reproduction
  -- kittens = females × litters/year × kittens/litter × survival × reproductive_years
  v_female_kittens := v_females * v_litters_per_year * v_kittens_per_litter
                      * v_survival_rate * v_reproductive_years;

  -- Male impact: each neutered male prevents impregnating multiple females
  -- But these overlap with spayed females, so we use a fraction
  v_male_kittens := v_males * v_male_pregnancies_prevented * v_kittens_per_litter
                    * v_survival_rate * v_reproductive_years * 0.3; -- 30% non-overlap factor

  v_moderate_total := (v_female_kittens + v_male_kittens) * v_conf_moderate;

  v_method := format(
    'females=%s × %s litters/yr × %s kittens/litter × %s survival × %s yrs + males=%s partial contribution',
    v_females, v_litters_per_year, v_kittens_per_litter, v_survival_rate, v_reproductive_years, v_males
  );

  RETURN QUERY
  SELECT 'conservative'::TEXT, ROUND(v_moderate_total * v_conf_conservative), v_method
  UNION ALL
  SELECT 'moderate'::TEXT, ROUND(v_moderate_total), v_method
  UNION ALL
  SELECT 'high'::TEXT, ROUND(v_moderate_total * v_conf_high), v_method;
END;
$$;

COMMENT ON FUNCTION ops.compute_kittens_prevented IS
  'Sex-aware kitten prevention model with 3 confidence tiers. '
  'Reads all parameters from ops.app_config. Pass actual female/male counts '
  'for precision, or omit for ratio-based estimation.';

-- ============================================================================
-- 2. Economic impact (multi-category × 3 tiers)
-- ============================================================================

CREATE OR REPLACE FUNCTION ops.compute_economic_impact(
  p_cats_altered INT,
  p_female_count INT DEFAULT NULL,
  p_male_count INT DEFAULT NULL
)
RETURNS TABLE (
  tier TEXT,
  kittens_prevented NUMERIC,
  shelter_cost NUMERIC,
  animal_control_cost NUMERIC,
  property_damage_cost NUMERIC,
  disease_cost NUMERIC,
  placement_cost NUMERIC,
  indirect_cost NUMERIC,
  total_cost NUMERIC,
  methodology JSONB
)
LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_shelter_capture_rate NUMERIC;
  v_shelter_intake_cost NUMERIC;
  v_ac_cost_per_complaint NUMERIC;
  v_complaints_per_cat NUMERIC;
  v_property_damage NUMERIC;
  v_disease_cost NUMERIC;
  v_placement_cost NUMERIC;
  v_indirect_multiplier NUMERIC;
  v_conf_conservative NUMERIC;
  v_conf_moderate NUMERIC;
  v_conf_high NUMERIC;
  v_reproductive_years NUMERIC;

  v_kittens_cons NUMERIC;
  v_kittens_mod NUMERIC;
  v_kittens_high NUMERIC;
BEGIN
  -- Read config
  v_shelter_capture_rate := ops.get_config_numeric('impact.shelter_capture_rate', 0.30);
  v_shelter_intake_cost := ops.get_config_numeric('impact.shelter_intake_cost_usd', 300);
  v_ac_cost_per_complaint := ops.get_config_numeric('impact.animal_control_cost_per_complaint_usd', 150);
  v_complaints_per_cat := ops.get_config_numeric('impact.complaints_per_unaltered_cat_per_year', 0.3);
  v_property_damage := ops.get_config_numeric('impact.property_damage_per_colony_per_year_usd', 200);
  v_disease_cost := ops.get_config_numeric('impact.disease_treatment_cost_per_cat_usd', 50);
  v_placement_cost := ops.get_config_numeric('impact.placement_cost_per_kitten_usd', 250);
  v_indirect_multiplier := ops.get_config_numeric('impact.indirect_cost_multiplier', 1.3);
  v_conf_conservative := ops.get_config_numeric('impact.confidence_conservative_multiplier', 0.6);
  v_conf_moderate := ops.get_config_numeric('impact.confidence_moderate_multiplier', 1.0);
  v_conf_high := ops.get_config_numeric('impact.confidence_high_multiplier', 1.8);
  v_reproductive_years := ops.get_config_numeric('impact.reproductive_years', 5);

  -- Get kittens prevented per tier
  SELECT kp.kittens_prevented INTO v_kittens_cons
  FROM ops.compute_kittens_prevented(p_cats_altered, p_female_count, p_male_count) kp
  WHERE kp.tier = 'conservative';

  SELECT kp.kittens_prevented INTO v_kittens_mod
  FROM ops.compute_kittens_prevented(p_cats_altered, p_female_count, p_male_count) kp
  WHERE kp.tier = 'moderate';

  SELECT kp.kittens_prevented INTO v_kittens_high
  FROM ops.compute_kittens_prevented(p_cats_altered, p_female_count, p_male_count) kp
  WHERE kp.tier = 'high';

  RETURN QUERY
  WITH tiers AS (
    SELECT 'conservative'::TEXT AS t, v_kittens_cons AS kp, v_conf_conservative AS conf
    UNION ALL
    SELECT 'moderate', v_kittens_mod, v_conf_moderate
    UNION ALL
    SELECT 'high', v_kittens_high, v_conf_high
  )
  SELECT
    tiers.t AS tier,
    tiers.kp AS kittens_prevented,
    -- Shelter: kittens × capture rate × intake cost
    ROUND(tiers.kp * v_shelter_capture_rate * v_shelter_intake_cost) AS shelter_cost,
    -- Animal control: cats altered × complaints/cat/year × reproductive_years × cost/complaint
    ROUND(p_cats_altered * v_complaints_per_cat * v_reproductive_years * v_ac_cost_per_complaint * tiers.conf) AS animal_control_cost,
    -- Property damage: estimated colonies prevented × damage/colony/year × years
    -- Rough: 1 colony per 15 cats, so cats/15 colonies prevented
    ROUND((p_cats_altered::NUMERIC / 15.0) * v_property_damage * v_reproductive_years * tiers.conf) AS property_damage_cost,
    -- Disease: kittens × disease cost (each prevented kitten = prevented disease vector)
    ROUND(tiers.kp * v_disease_cost) AS disease_cost,
    -- Placement: kittens × shelter_capture_rate × placement cost
    ROUND(tiers.kp * v_shelter_capture_rate * v_placement_cost) AS placement_cost,
    -- Indirect: sum of above × (multiplier - 1) = the additional indirect portion
    ROUND(
      (
        tiers.kp * v_shelter_capture_rate * v_shelter_intake_cost
        + p_cats_altered * v_complaints_per_cat * v_reproductive_years * v_ac_cost_per_complaint * tiers.conf
        + (p_cats_altered::NUMERIC / 15.0) * v_property_damage * v_reproductive_years * tiers.conf
        + tiers.kp * v_disease_cost
        + tiers.kp * v_shelter_capture_rate * v_placement_cost
      ) * (v_indirect_multiplier - 1)
    ) AS indirect_cost,
    -- Total: all direct + indirect
    ROUND(
      (
        tiers.kp * v_shelter_capture_rate * v_shelter_intake_cost
        + p_cats_altered * v_complaints_per_cat * v_reproductive_years * v_ac_cost_per_complaint * tiers.conf
        + (p_cats_altered::NUMERIC / 15.0) * v_property_damage * v_reproductive_years * tiers.conf
        + tiers.kp * v_disease_cost
        + tiers.kp * v_shelter_capture_rate * v_placement_cost
      ) * v_indirect_multiplier
    ) AS total_cost,
    jsonb_build_object(
      'model', 'v2_sex_aware_multi_category',
      'shelter_capture_rate', v_shelter_capture_rate,
      'shelter_intake_cost_usd', v_shelter_intake_cost,
      'ac_cost_per_complaint', v_ac_cost_per_complaint,
      'complaints_per_cat_year', v_complaints_per_cat,
      'property_damage_per_colony_year', v_property_damage,
      'disease_cost_per_cat', v_disease_cost,
      'placement_cost_per_kitten', v_placement_cost,
      'indirect_multiplier', v_indirect_multiplier,
      'reproductive_years', v_reproductive_years,
      'confidence_tier', tiers.t
    ) AS methodology
  FROM tiers;
END;
$$;

COMMENT ON FUNCTION ops.compute_economic_impact IS
  'Multi-category economic impact with 3 confidence tiers. '
  'Categories: shelter, animal control, property, disease, placement, indirect. '
  'All parameters from ops.app_config (MIG_3135).';

-- ============================================================================
-- 3. Org-wide economic impact summary (single-row view)
-- ============================================================================

CREATE OR REPLACE VIEW ops.v_economic_impact_summary AS
WITH altered AS (
  SELECT
    GREATEST(
      COALESCE((SELECT SUM(donor_facing_count) FROM ops.v_alteration_counts_by_year), 0),
      (SELECT COUNT(DISTINCT a2.cat_id) FROM (
        SELECT a3.cat_id FROM ops.appointments a3
        WHERE a3.cat_id IS NOT NULL AND a3.service_type IS NOT NULL
          AND a3.service_type ~* 'Cat Spay|Cat Neuter'
        GROUP BY a3.cat_id
      ) a2)
    )::INT AS cats_altered,
    (SELECT COUNT(DISTINCT a4.cat_id) FILTER (WHERE c4.sex = 'Female')
     FROM ops.appointments a4
     JOIN sot.cats c4 ON c4.cat_id = a4.cat_id AND c4.merged_into_cat_id IS NULL
     WHERE a4.service_type ~* 'Cat Spay|Cat Neuter')::INT AS female_count,
    (SELECT COUNT(DISTINCT a5.cat_id) FILTER (WHERE c5.sex = 'Male')
     FROM ops.appointments a5
     JOIN sot.cats c5 ON c5.cat_id = a5.cat_id AND c5.merged_into_cat_id IS NULL
     WHERE a5.service_type ~* 'Cat Spay|Cat Neuter')::INT AS male_count
),
impact AS (
  SELECT * FROM ops.compute_economic_impact(
    (SELECT cats_altered FROM altered)::INT,
    (SELECT female_count FROM altered)::INT,
    (SELECT male_count FROM altered)::INT
  )
)
SELECT
  a.cats_altered,
  a.female_count,
  a.male_count,
  i.tier,
  i.kittens_prevented,
  i.shelter_cost,
  i.animal_control_cost,
  i.property_damage_cost,
  i.disease_cost,
  i.placement_cost,
  i.indirect_cost,
  i.total_cost,
  i.methodology
FROM altered a
CROSS JOIN impact i;

COMMENT ON VIEW ops.v_economic_impact_summary IS
  'Org-wide economic impact summary with 3 confidence tiers × 6 cost categories. '
  'Single query for the dashboard API. See MIG_3135 for config, MIG_3136 for functions.';

-- ============================================================================
-- 4. Per-city economic impact (PostGIS spatial join)
-- ============================================================================

CREATE OR REPLACE VIEW ops.v_economic_impact_by_city AS
WITH city_cats AS (
  SELECT
    cb.city_name,
    COUNT(DISTINCT c.cat_id) AS cats_altered,
    COUNT(DISTINCT c.cat_id) FILTER (WHERE c.sex = 'Female') AS female_count,
    COUNT(DISTINCT c.cat_id) FILTER (WHERE c.sex = 'Male') AS male_count,
    COUNT(DISTINCT p.place_id) AS places_served
  FROM sot.cats c
  JOIN sot.cat_place cp ON cp.cat_id = c.cat_id
  JOIN sot.places p ON p.place_id = cp.place_id AND p.merged_into_place_id IS NULL
  JOIN sot.addresses addr ON addr.address_id = p.sot_address_id
  JOIN sot.city_boundaries cb ON ST_Contains(
    cb.geom,
    ST_SetSRID(ST_Point(addr.longitude, addr.latitude), 4326)
  )
  WHERE c.merged_into_cat_id IS NULL
    AND c.altered_by = 'ffsc'
  GROUP BY cb.city_name
),
city_impact AS (
  SELECT
    cc.city_name,
    cc.cats_altered,
    cc.female_count,
    cc.male_count,
    cc.places_served,
    ei.*
  FROM city_cats cc
  CROSS JOIN LATERAL ops.compute_economic_impact(
    cc.cats_altered::INT, cc.female_count::INT, cc.male_count::INT
  ) ei
)
SELECT
  city_name,
  cats_altered,
  female_count,
  male_count,
  places_served,
  tier,
  kittens_prevented,
  shelter_cost,
  animal_control_cost,
  property_damage_cost,
  disease_cost,
  placement_cost,
  indirect_cost,
  total_cost
FROM city_impact
ORDER BY cats_altered DESC, tier;

COMMENT ON VIEW ops.v_economic_impact_by_city IS
  'Per-city economic impact using PostGIS spatial join to sot.city_boundaries. '
  'Returns 3 rows per city (one per confidence tier). Requires MIG_3133 boundaries loaded.';

-- ============================================================================
-- 5. City impact timeseries function
-- ============================================================================

CREATE OR REPLACE FUNCTION ops.city_impact_timeseries(
  p_city_name TEXT,
  p_granularity TEXT DEFAULT 'year' -- 'year' or 'month'
)
RETURNS TABLE (
  period TEXT,
  cats_altered INT,
  female_count INT,
  male_count INT,
  kittens_prevented_moderate NUMERIC,
  total_cost_moderate NUMERIC
)
LANGUAGE plpgsql STABLE AS $$
BEGIN
  RETURN QUERY
  WITH periods AS (
    SELECT
      CASE
        WHEN p_granularity = 'month' THEN TO_CHAR(a.appointment_date, 'YYYY-MM')
        ELSE EXTRACT(YEAR FROM a.appointment_date)::TEXT
      END AS period,
      COUNT(DISTINCT c.cat_id) AS cats_altered,
      COUNT(DISTINCT c.cat_id) FILTER (WHERE c.sex = 'Female') AS female_count,
      COUNT(DISTINCT c.cat_id) FILTER (WHERE c.sex = 'Male') AS male_count
    FROM ops.appointments a
    JOIN sot.cats c ON c.cat_id = a.cat_id AND c.merged_into_cat_id IS NULL
      AND c.altered_by = 'ffsc'
    JOIN sot.cat_place cp ON cp.cat_id = c.cat_id
    JOIN sot.places p ON p.place_id = cp.place_id AND p.merged_into_place_id IS NULL
    JOIN sot.addresses addr ON addr.address_id = p.sot_address_id
    JOIN sot.city_boundaries cb ON ST_Contains(
      cb.geom,
      ST_SetSRID(ST_Point(addr.longitude, addr.latitude), 4326)
    )
    WHERE a.appointment_date IS NOT NULL
      AND a.service_type ~* 'Cat Spay|Cat Neuter'
      AND cb.city_name ILIKE p_city_name
    GROUP BY 1
  )
  SELECT
    pd.period,
    pd.cats_altered::INT AS cats_altered,
    pd.female_count::INT AS female_count,
    pd.male_count::INT AS male_count,
    (SELECT kp.kittens_prevented FROM ops.compute_kittens_prevented(pd.cats_altered::INT, pd.female_count::INT, pd.male_count::INT) kp WHERE kp.tier = 'moderate') AS kittens_prevented_moderate,
    (SELECT ei.total_cost FROM ops.compute_economic_impact(pd.cats_altered::INT, pd.female_count::INT, pd.male_count::INT) ei WHERE ei.tier = 'moderate') AS total_cost_moderate
  FROM periods pd
  ORDER BY pd.period;
END;
$$;

COMMENT ON FUNCTION ops.city_impact_timeseries IS
  'Time series of economic impact for a single city. Supports year or month granularity. '
  'Uses moderate confidence tier for charting. Requires city boundaries loaded.';

-- ============================================================================
-- Verify
-- ============================================================================
-- SELECT * FROM ops.compute_kittens_prevented(37000);
-- SELECT * FROM ops.compute_economic_impact(37000);
-- SELECT * FROM ops.v_economic_impact_summary WHERE tier = 'moderate';
-- SELECT * FROM ops.v_economic_impact_by_city WHERE tier = 'moderate';
-- SELECT * FROM ops.city_impact_timeseries('Petaluma');
