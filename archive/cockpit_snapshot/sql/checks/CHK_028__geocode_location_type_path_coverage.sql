-- CHK_028__geocode_location_type_path_coverage
-- Counts which JSON path contains location_type in geocode_result
SELECT
  COUNT(*) AS total_addresses,
  COUNT(geocode_result) AS with_geocode_result,
  COUNT(NULLIF(geocode_result #>> '{geometry,location_type}', '')) AS path_geometry_location_type,
  COUNT(NULLIF(geocode_result #>> '{results,0,geometry,location_type}', '')) AS path_results0_geometry_location_type,
  COUNT(COALESCE(
    NULLIF(geocode_result #>> '{geometry,location_type}', ''),
    NULLIF(geocode_result #>> '{results,0,geometry,location_type}', '')
  )) AS any_location_type
FROM trapper.addresses;
