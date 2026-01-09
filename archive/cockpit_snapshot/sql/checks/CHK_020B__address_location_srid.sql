-- CHK_020B__address_location_srid
-- Shows distinct SRIDs used in location column
SELECT
    ST_SRID(location) AS srid,
    COUNT(*) AS count
FROM trapper.addresses
WHERE location IS NOT NULL
GROUP BY ST_SRID(location)
ORDER BY count DESC;
