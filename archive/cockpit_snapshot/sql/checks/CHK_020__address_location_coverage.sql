-- CHK_020__address_location_coverage
-- Shows count of addresses with/without location geometry
SELECT
    COUNT(*) AS total_addresses,
    COUNT(location) AS with_location,
    COUNT(*) - COUNT(location) AS without_location,
    ROUND(100.0 * COUNT(location) / NULLIF(COUNT(*), 0), 1) AS pct_with_location
FROM trapper.addresses;
