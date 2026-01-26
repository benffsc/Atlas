\echo '=== MIG_721: Socioeconomic Reference Data for Ecological Analysis ==='
\echo 'Adds income, housing, and demographic fields to ref_sonoma_geography'

-- Add socioeconomic columns to ref_sonoma_geography
ALTER TABLE trapper.ref_sonoma_geography
  ADD COLUMN IF NOT EXISTS median_household_income INTEGER,
  ADD COLUMN IF NOT EXISTS pct_below_poverty NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS pct_renter_occupied NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS pct_owner_occupied NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS pct_mobile_homes NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS pct_single_family NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS pct_multi_family NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS median_home_value INTEGER,
  ADD COLUMN IF NOT EXISTS pet_ownership_index NUMERIC(5,2),  -- Computed risk score
  ADD COLUMN IF NOT EXISTS tnr_priority_score NUMERIC(5,2);   -- Computed priority

COMMENT ON COLUMN trapper.ref_sonoma_geography.median_household_income IS 'Median household income from Census ACS';
COMMENT ON COLUMN trapper.ref_sonoma_geography.pct_below_poverty IS 'Percentage of households below poverty line';
COMMENT ON COLUMN trapper.ref_sonoma_geography.pct_renter_occupied IS 'Percentage of housing units that are renter-occupied';
COMMENT ON COLUMN trapper.ref_sonoma_geography.pct_mobile_homes IS 'Percentage of housing that are mobile homes/trailers';
COMMENT ON COLUMN trapper.ref_sonoma_geography.pet_ownership_index IS 'Computed index predicting unaltered pet likelihood (higher = more likely)';
COMMENT ON COLUMN trapper.ref_sonoma_geography.tnr_priority_score IS 'Computed TNR priority based on socioeconomic + ecological factors';

-- Create table to track data freshness and staleness
CREATE TABLE IF NOT EXISTS trapper.data_freshness_tracking (
  tracking_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  data_category TEXT NOT NULL,  -- 'census', 'google_maps', 'ecological', 'conditions'
  last_full_refresh TIMESTAMPTZ,
  last_incremental_update TIMESTAMPTZ,
  records_count INTEGER,
  staleness_threshold_days INTEGER DEFAULT 365,  -- When to flag as stale
  auto_refresh_enabled BOOLEAN DEFAULT FALSE,
  refresh_schedule TEXT,  -- cron expression or 'manual'
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seed freshness tracking for our data categories
INSERT INTO trapper.data_freshness_tracking (data_category, staleness_threshold_days, refresh_schedule, notes)
VALUES
  ('census_demographics', 365, 'annual', 'US Census ACS 5-year estimates, updated annually'),
  ('google_maps_classification', 30, 'daily', 'AI classification of Google Maps entries'),
  ('place_conditions', 180, 'manual', 'Historical ecological conditions from multiple sources'),
  ('zone_data_coverage', 7, 'weekly', 'Data coverage statistics by service zone'),
  ('colony_estimates', 90, 'continuous', 'Colony size estimates from observations and clinic data')
ON CONFLICT DO NOTHING;

-- View to identify stale data
CREATE OR REPLACE VIEW trapper.v_data_staleness_alerts AS
SELECT
  data_category,
  last_full_refresh,
  last_incremental_update,
  staleness_threshold_days,
  COALESCE(last_incremental_update, last_full_refresh) as last_activity,
  CASE
    WHEN COALESCE(last_incremental_update, last_full_refresh) IS NULL THEN 'never_refreshed'
    WHEN COALESCE(last_incremental_update, last_full_refresh) < NOW() - (staleness_threshold_days || ' days')::INTERVAL THEN 'stale'
    WHEN COALESCE(last_incremental_update, last_full_refresh) < NOW() - (staleness_threshold_days * 0.75 || ' days')::INTERVAL THEN 'aging'
    ELSE 'fresh'
  END as freshness_status,
  records_count,
  notes
FROM trapper.data_freshness_tracking
ORDER BY
  CASE
    WHEN COALESCE(last_incremental_update, last_full_refresh) IS NULL THEN 1
    WHEN COALESCE(last_incremental_update, last_full_refresh) < NOW() - (staleness_threshold_days || ' days')::INTERVAL THEN 2
    ELSE 3
  END;

COMMENT ON VIEW trapper.v_data_staleness_alerts IS 'Shows which data categories need refresh based on staleness thresholds';

-- Function to compute TNR priority score based on socioeconomic factors
CREATE OR REPLACE FUNCTION trapper.compute_area_tnr_priority(p_area_id UUID)
RETURNS NUMERIC AS $$
DECLARE
  v_score NUMERIC := 50;  -- Base score
  v_area RECORD;
BEGIN
  SELECT * INTO v_area FROM trapper.ref_sonoma_geography WHERE area_id = p_area_id;

  IF NOT FOUND THEN RETURN NULL; END IF;

  -- Income factor (lower income = higher priority)
  IF v_area.median_household_income IS NOT NULL THEN
    IF v_area.median_household_income < 40000 THEN v_score := v_score + 20;
    ELSIF v_area.median_household_income < 60000 THEN v_score := v_score + 10;
    ELSIF v_area.median_household_income > 100000 THEN v_score := v_score - 10;
    END IF;
  END IF;

  -- Poverty factor
  IF v_area.pct_below_poverty IS NOT NULL THEN
    v_score := v_score + (v_area.pct_below_poverty * 0.5);
  END IF;

  -- Renter factor (higher renter = higher priority)
  IF v_area.pct_renter_occupied IS NOT NULL THEN
    v_score := v_score + (v_area.pct_renter_occupied * 0.2);
  END IF;

  -- Mobile home factor (strong indicator)
  IF v_area.pct_mobile_homes IS NOT NULL THEN
    v_score := v_score + (v_area.pct_mobile_homes * 1.0);
  END IF;

  -- Normalize to 0-100
  RETURN GREATEST(0, LEAST(100, v_score));
END;
$$ LANGUAGE plpgsql STABLE;

-- View correlating socioeconomic data with actual TNR activity
CREATE OR REPLACE VIEW trapper.v_area_tnr_correlation AS
SELECT
  g.area_id,
  g.area_name,
  g.area_type,
  g.population,
  g.households,
  g.median_household_income,
  g.pct_below_poverty,
  g.pct_renter_occupied,
  g.pct_mobile_homes,
  g.tnr_priority_score,
  -- Actual TNR activity from places in this area
  COUNT(DISTINCT p.place_id) as places_count,
  COUNT(DISTINCT r.request_id) as requests_count,
  COUNT(DISTINCT cpr.cat_id) as cats_linked,
  COUNT(DISTINCT a.appointment_id) FILTER (WHERE a.appointment_date > NOW() - INTERVAL '2 years') as appointments_2yr,
  -- Alteration rate for area
  ROUND(100.0 * COUNT(DISTINCT cp.cat_id) / NULLIF(COUNT(DISTINCT cpr.cat_id), 0), 1) as alteration_rate_pct,
  -- Correlation validation
  CASE
    WHEN g.tnr_priority_score > 70 AND COUNT(DISTINCT r.request_id) > 10 THEN 'validated_high'
    WHEN g.tnr_priority_score < 30 AND COUNT(DISTINCT r.request_id) < 5 THEN 'validated_low'
    WHEN g.tnr_priority_score > 70 AND COUNT(DISTINCT r.request_id) < 5 THEN 'underserved'
    WHEN g.tnr_priority_score < 30 AND COUNT(DISTINCT r.request_id) > 10 THEN 'unexpected_activity'
    ELSE 'normal'
  END as correlation_status
FROM trapper.ref_sonoma_geography g
LEFT JOIN trapper.places p ON
  (g.area_type = 'zip' AND p.formatted_address ILIKE '%' || g.area_code || '%')
  OR (g.area_type = 'city' AND p.service_zone = g.area_name)
LEFT JOIN trapper.sot_requests r ON r.place_id = p.place_id
LEFT JOIN trapper.cat_place_relationships cpr ON cpr.place_id = p.place_id
LEFT JOIN trapper.sot_appointments a ON a.cat_id = cpr.cat_id
LEFT JOIN trapper.cat_procedures cp ON cp.cat_id = cpr.cat_id AND (cp.is_spay OR cp.is_neuter)
WHERE g.area_type IN ('zip', 'city', 'neighborhood')
GROUP BY g.area_id, g.area_name, g.area_type, g.population, g.households,
         g.median_household_income, g.pct_below_poverty, g.pct_renter_occupied,
         g.pct_mobile_homes, g.tnr_priority_score;

COMMENT ON VIEW trapper.v_area_tnr_correlation IS 'Correlates socioeconomic indicators with actual TNR activity. Identifies underserved high-priority areas.';

-- Add to Tippy catalog
INSERT INTO trapper.tippy_view_catalog (view_name, category, description, key_columns, filter_columns, example_questions)
VALUES
  ('v_data_staleness_alerts', 'quality', 'Shows which data categories need refresh based on staleness thresholds',
   ARRAY['data_category'], ARRAY['freshness_status'],
   ARRAY['What data needs refreshing?', 'Is our Census data current?', 'Show stale data']),
  ('v_area_tnr_correlation', 'ecology', 'Correlates socioeconomic indicators with actual TNR activity',
   ARRAY['area_name', 'area_type'], ARRAY['correlation_status', 'area_type'],
   ARRAY['Which low-income areas are underserved?', 'Where should we target outreach?', 'Show areas with high priority but low activity'])
ON CONFLICT (view_name) DO UPDATE SET
  description = EXCLUDED.description,
  example_questions = EXCLUDED.example_questions;

\echo '=== MIG_721 Complete ==='
\echo 'Added: socioeconomic columns, data freshness tracking, TNR priority scoring'
\echo 'Views: v_data_staleness_alerts, v_area_tnr_correlation'
