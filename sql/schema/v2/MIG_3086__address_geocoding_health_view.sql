-- MIG_3086: Address geocoding health monitoring view
--
-- DATA_GAP_067 / FFS-1253
--
-- Problem: 530 addresses with NULL coords went undetected because there was
-- no monitoring for address coordinate coverage.

-- Health overview by geocoding status
CREATE OR REPLACE VIEW ops.v_address_geocoding_health AS
SELECT
  COALESCE(a.geocoding_status, 'unknown') AS geocoding_status,
  count(*) AS total,
  count(*) FILTER (WHERE a.latitude IS NOT NULL) AS has_coords,
  count(*) FILTER (WHERE a.latitude IS NULL) AS missing_coords,
  count(*) FILTER (WHERE a.latitude IS NULL AND p.location IS NOT NULL) AS fixable_from_place,
  ROUND(100.0 * count(*) FILTER (WHERE a.latitude IS NOT NULL) / NULLIF(count(*), 0), 1) AS coord_coverage_pct
FROM sot.addresses a
LEFT JOIN sot.places p ON COALESCE(p.sot_address_id, p.address_id) = a.address_id
  AND p.merged_into_place_id IS NULL
WHERE a.formatted_address IS NOT NULL
GROUP BY COALESCE(a.geocoding_status, 'unknown')
ORDER BY total DESC;

COMMENT ON VIEW ops.v_address_geocoding_health IS 'FFS-1253: Monitoring view for address coordinate coverage. Alerts on desync between places and addresses.';

-- Desync detection: places with geometry but address has NULL coords (should be 0)
CREATE OR REPLACE VIEW ops.v_address_coord_desync AS
SELECT
  p.place_id,
  p.display_name,
  p.formatted_address,
  ST_Y(p.location::geometry) AS place_lat,
  ST_X(p.location::geometry) AS place_lng,
  a.address_id,
  a.display_address,
  a.geocoding_status
FROM sot.places p
JOIN sot.addresses a ON a.address_id = COALESCE(p.sot_address_id, p.address_id)
WHERE p.merged_into_place_id IS NULL
  AND p.location IS NOT NULL
  AND a.latitude IS NULL;

COMMENT ON VIEW ops.v_address_coord_desync IS 'FFS-1253: Should be EMPTY after FFS-1250 + FFS-1251. Non-zero rows indicate pipeline regression.';
