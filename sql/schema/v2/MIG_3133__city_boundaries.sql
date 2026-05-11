-- MIG_3133: City limit boundaries for spatial queries
-- Enables "cats within [city] limits" instead of "address contains [city]"
-- Source: OpenStreetMap Nominatim administrative boundaries
--
-- NOTE: This migration creates the table. The actual boundary data is loaded
-- via the load-city-boundaries.sh script which reads GeoJSON from OSM.

CREATE TABLE IF NOT EXISTS sot.city_boundaries (
  city_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  city_name TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'California',
  county TEXT NOT NULL DEFAULT 'Sonoma',
  geom GEOMETRY(MultiPolygon, 4326),
  source TEXT NOT NULL DEFAULT 'openstreetmap_nominatim',
  imported_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (city_name, state, county)
);

CREATE INDEX IF NOT EXISTS idx_city_boundaries_geom
  ON sot.city_boundaries USING GIST (geom);

-- Helper function: count cats FFSC TNR'd within a city's official limits
-- IMPORTANT: Uses altered_by='ffsc' (not just altered_status) to count only
-- cats WE fixed, not cats that were already altered by another org.
-- Includes deceased/departed cats — we still TNR'd them, the surgery still happened.
CREATE OR REPLACE FUNCTION sot.cats_tnrd_within_city(p_city_name TEXT)
RETURNS TABLE (
  year INT,
  total_tnr BIGINT,
  spayed BIGINT,
  neutered BIGINT
)
LANGUAGE SQL STABLE AS $$
  SELECT
    EXTRACT(YEAR FROM COALESCE(
      (SELECT MIN(a.appointment_date) FROM ops.appointments a WHERE a.cat_id = c.cat_id AND (a.is_spay = TRUE OR a.is_neuter = TRUE)),
      cp.created_at
    ))::INT AS year,
    COUNT(DISTINCT c.cat_id) AS total_tnr,
    COUNT(DISTINCT c.cat_id) FILTER (WHERE c.altered_status = 'spayed') AS spayed,
    COUNT(DISTINCT c.cat_id) FILTER (WHERE c.altered_status = 'neutered') AS neutered
  FROM sot.cats c
  JOIN sot.cat_place cp ON cp.cat_id = c.cat_id
  JOIN sot.places p ON p.place_id = cp.place_id AND p.merged_into_place_id IS NULL
  JOIN sot.addresses addr ON addr.address_id = p.sot_address_id
  JOIN sot.city_boundaries cb ON ST_Contains(cb.geom, ST_SetSRID(ST_Point(addr.longitude, addr.latitude), 4326))
  WHERE c.merged_into_cat_id IS NULL
    AND c.altered_by = 'ffsc'
    AND cb.city_name ILIKE p_city_name
  GROUP BY 1
  ORDER BY 1;
$$;

-- Simpler: total count within city limits
CREATE OR REPLACE FUNCTION sot.total_tnr_within_city(p_city_name TEXT)
RETURNS TABLE (total BIGINT, spayed BIGINT, neutered BIGINT, places BIGINT)
LANGUAGE SQL STABLE AS $$
  SELECT
    COUNT(DISTINCT c.cat_id) AS total,
    COUNT(DISTINCT c.cat_id) FILTER (WHERE c.altered_status = 'spayed') AS spayed,
    COUNT(DISTINCT c.cat_id) FILTER (WHERE c.altered_status = 'neutered') AS neutered,
    COUNT(DISTINCT p.place_id) AS places
  FROM sot.cats c
  JOIN sot.cat_place cp ON cp.cat_id = c.cat_id
  JOIN sot.places p ON p.place_id = cp.place_id AND p.merged_into_place_id IS NULL
  JOIN sot.addresses addr ON addr.address_id = p.sot_address_id
  JOIN sot.city_boundaries cb ON ST_Contains(cb.geom, ST_SetSRID(ST_Point(addr.longitude, addr.latitude), 4326))
  WHERE c.merged_into_cat_id IS NULL
    AND c.altered_by = 'ffsc'
    AND cb.city_name ILIKE p_city_name;
$$;
