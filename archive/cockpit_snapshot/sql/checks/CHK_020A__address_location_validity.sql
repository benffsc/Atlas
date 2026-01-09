-- CHK_020A__address_location_validity
-- Checks if any location geometries are invalid
SELECT
    COUNT(*) AS total_with_location,
    COUNT(*) FILTER (WHERE ST_IsValid(location)) AS valid_count,
    COUNT(*) FILTER (WHERE NOT ST_IsValid(location)) AS invalid_count
FROM trapper.addresses
WHERE location IS NOT NULL;
