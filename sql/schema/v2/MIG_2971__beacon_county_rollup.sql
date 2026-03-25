-- MIG_2971: Beacon county-level alteration rollup
-- Purpose: Aggregates zone-level TNR data by county for county-level impact reporting.
-- Maps service_zone (city names) to counties using a lookup function.
-- Depends on: MIG_2934 (beacon.v_zone_alteration_rollup), MIG_2935 (zones + service areas)
-- =============================================================================

\echo 'MIG_2971: Creating county alteration rollup...'

-- 1. City-to-county mapping function
-- Based on Sonoma County service area geography
CREATE OR REPLACE FUNCTION beacon.city_to_county(p_city TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    -- Sonoma County cities
    WHEN p_city IN (
      'Santa Rosa', 'Petaluma', 'Rohnert Park', 'Windsor', 'Healdsburg',
      'Sonoma', 'Cotati', 'Sebastopol', 'Cloverdale', 'Guerneville',
      'Bodega Bay', 'Occidental', 'Forestville', 'Graton', 'Glen Ellen',
      'Kenwood', 'Penngrove', 'Boyes Hot Springs', 'El Verano', 'Larkfield',
      'Larkfield-Wikiup', 'Fulton', 'Roseland', 'Monte Rio', 'Jenner',
      'Cazadero', 'Duncans Mills', 'Camp Meeker', 'Annapolis', 'Sea Ranch',
      'Stewarts Point', 'Geyserville', 'Timber Cove'
    ) THEN 'Sonoma'
    -- Marin County cities
    WHEN p_city IN (
      'San Rafael', 'Novato', 'Mill Valley', 'Larkspur', 'Corte Madera',
      'San Anselmo', 'Fairfax', 'Tiburon', 'Sausalito', 'Belvedere',
      'Ross', 'Bolinas', 'Stinson Beach', 'Point Reyes Station', 'Inverness',
      'Olema', 'Tomales', 'Marshall', 'Nicasio', 'Woodacre',
      'Lagunitas', 'Forest Knolls', 'San Geronimo'
    ) THEN 'Marin'
    -- Napa County cities
    WHEN p_city IN (
      'Napa', 'St. Helena', 'Calistoga', 'Yountville', 'American Canyon',
      'Angwin', 'Deer Park', 'Rutherford', 'Oakville', 'Pope Valley'
    ) THEN 'Napa'
    -- Mendocino County cities
    WHEN p_city IN (
      'Ukiah', 'Fort Bragg', 'Willits', 'Point Arena', 'Mendocino',
      'Hopland', 'Boonville', 'Philo', 'Laytonville', 'Covelo',
      'Redwood Valley', 'Comptche', 'Elk', 'Albion', 'Little River',
      'Gualala', 'Caspar', 'Talmage'
    ) THEN 'Mendocino'
    -- Lake County cities
    WHEN p_city IN (
      'Lakeport', 'Clearlake', 'Kelseyville', 'Lower Lake', 'Middletown',
      'Upper Lake', 'Nice', 'Lucerne', 'Clearlake Oaks', 'Cobb',
      'Hidden Valley Lake', 'Glenhaven'
    ) THEN 'Lake'
    ELSE 'Other'
  END
$$;

COMMENT ON FUNCTION beacon.city_to_county(TEXT) IS
  'Maps a city/service_zone name to its parent county. Used for county-level aggregation.';


-- 2. County alteration rollup view
CREATE OR REPLACE VIEW beacon.v_county_alteration_rollup AS
SELECT
  beacon.city_to_county(z.service_zone) AS county,
  COUNT(DISTINCT z.zone_id) AS zone_count,
  SUM(z.place_count) AS place_count,
  SUM(z.total_cats) AS total_cats,
  SUM(z.altered_cats) AS altered_cats,
  SUM(z.intact_cats) AS intact_cats,
  SUM(z.unknown_status_cats) AS unknown_status_cats,
  CASE
    WHEN SUM(z.altered_cats) + SUM(z.intact_cats) > 0
    THEN ROUND(100.0 * SUM(z.altered_cats) / (SUM(z.altered_cats) + SUM(z.intact_cats)), 1)
    ELSE NULL
  END AS alteration_rate_pct,
  SUM(z.total_requests) AS total_requests,
  SUM(z.active_requests) AS active_requests,
  SUM(z.alterations_last_90d) AS alterations_last_90d,
  SUM(COALESCE(z.estimated_population, 0)) AS estimated_population
FROM beacon.v_zone_alteration_rollup z
GROUP BY beacon.city_to_county(z.service_zone)
ORDER BY SUM(z.total_cats) DESC;

COMMENT ON VIEW beacon.v_county_alteration_rollup IS
  'Aggregates zone-level TNR metrics by county for county-level impact reporting.';


\echo 'MIG_2971: Done.'
\echo '  Function: beacon.city_to_county(TEXT)'
\echo '  View:     beacon.v_county_alteration_rollup'
