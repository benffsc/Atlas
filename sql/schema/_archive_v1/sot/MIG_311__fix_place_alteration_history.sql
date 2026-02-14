-- MIG_311: Fix Place Alteration History View
--
-- Problem: v_place_alteration_history was showing incorrect data:
--   1. yearly_breakdown grouped by REQUEST year, not PROCEDURE year
--   2. total_cats_altered only counted cats altered after request date
--   3. All historical cats attributed to the single request year
--
-- Solution: Create a proper place-centric view that:
--   - Counts ALL cats altered at the place (regardless of request timing)
--   - Groups by actual PROCEDURE year
--   - Works independently of request attribution windows

\echo ''
\echo '=============================================='
\echo 'MIG_311: Fix Place Alteration History View'
\echo '=============================================='
\echo ''

-- Drop the old view
DROP VIEW IF EXISTS trapper.v_place_alteration_history CASCADE;

-- Create new place-centric alteration history view
CREATE OR REPLACE VIEW trapper.v_place_alteration_history AS
WITH place_cat_procedures AS (
  -- Get all cats linked to places and their alteration procedures
  SELECT DISTINCT
    cpr.place_id,
    cp.cat_id,
    cp.procedure_date,
    cp.is_spay,
    cp.is_neuter,
    c.sex,
    EXTRACT(YEAR FROM cp.procedure_date)::INT AS procedure_year
  FROM trapper.cat_place_relationships cpr
  JOIN trapper.sot_cats c ON c.cat_id = cpr.cat_id
  JOIN trapper.cat_procedures cp ON cp.cat_id = c.cat_id
  WHERE (cp.is_spay = TRUE OR cp.is_neuter = TRUE)
    AND cp.procedure_date IS NOT NULL
),
place_stats AS (
  -- Aggregate stats per place
  SELECT
    p.place_id,
    p.display_name AS place_name,
    p.formatted_address,
    p.service_zone,

    -- Total cats altered at this place (all time)
    COUNT(DISTINCT pcp.cat_id) AS total_cats_altered,

    -- Sex breakdown
    COUNT(DISTINCT CASE WHEN LOWER(pcp.sex) = 'male' THEN pcp.cat_id END) AS total_males,
    COUNT(DISTINCT CASE WHEN LOWER(pcp.sex) = 'female' THEN pcp.cat_id END) AS total_females,

    -- Date range
    MIN(pcp.procedure_date) AS first_procedure_date,
    MAX(pcp.procedure_date) AS latest_procedure_date
  FROM trapper.places p
  LEFT JOIN place_cat_procedures pcp ON pcp.place_id = p.place_id
  GROUP BY p.place_id, p.display_name, p.formatted_address, p.service_zone
),
yearly_breakdown AS (
  -- Breakdown by actual procedure year
  SELECT
    place_id,
    procedure_year,
    COUNT(DISTINCT cat_id) AS cats_altered
  FROM place_cat_procedures
  GROUP BY place_id, procedure_year
),
yearly_json AS (
  -- Convert to JSON object
  SELECT
    place_id,
    jsonb_object_agg(
      procedure_year::TEXT,
      jsonb_build_object('altered', cats_altered)
    ) AS yearly_breakdown
  FROM yearly_breakdown
  GROUP BY place_id
),
request_counts AS (
  -- Count requests at each place
  SELECT
    place_id,
    COUNT(*) AS total_requests
  FROM trapper.sot_requests
  WHERE status != 'cancelled'
    AND place_id IS NOT NULL
  GROUP BY place_id
)
SELECT
  ps.place_id,
  ps.place_name,
  ps.formatted_address,
  ps.service_zone,
  COALESCE(rc.total_requests, 0) AS total_requests,

  -- For backward compatibility, keep total_cats_caught = total altered
  ps.total_cats_altered AS total_cats_caught,
  ps.total_cats_altered,

  -- Pre-altered doesn't really apply at place level - set to 0
  0 AS total_already_altered,

  ps.total_males,
  ps.total_females,

  -- Alteration rate at place level = 100% since we're counting all alterations
  -- (In future, this could compare to colony_size_estimate)
  100.0 AS place_alteration_rate_pct,

  ps.first_procedure_date AS first_request_date,
  ps.latest_procedure_date AS latest_request_date,

  COALESCE(yj.yearly_breakdown, '{}'::jsonb) AS yearly_breakdown

FROM place_stats ps
LEFT JOIN yearly_json yj ON yj.place_id = ps.place_id
LEFT JOIN request_counts rc ON rc.place_id = ps.place_id
WHERE ps.total_cats_altered > 0;

\echo ''
\echo 'MIG_311 complete!'
\echo ''
\echo 'Changes:'
\echo '  - yearly_breakdown now grouped by PROCEDURE year, not request year'
\echo '  - total_cats_altered now counts ALL cats altered at place'
\echo '  - Uses cat_procedures table directly, not request windows'
\echo ''

COMMENT ON VIEW trapper.v_place_alteration_history IS
'Place-level alteration statistics based on actual procedure dates.

Groups cats by the year they were actually altered, not when the request was created.
This provides accurate historical data for places with long TNR histories.

Key columns:
- total_cats_altered: All cats ever altered at this place
- yearly_breakdown: JSON object with procedure counts per year
- first_request_date: Actually the first procedure date
- latest_request_date: Actually the latest procedure date';
