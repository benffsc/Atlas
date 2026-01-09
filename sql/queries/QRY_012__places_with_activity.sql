-- QRY_012__places_with_activity.sql
-- Places with activity signals from multiple sources
--
-- Shows places that have connections to people, along with
-- their activity flags and source information.
--
-- Usage:
--   psql "$DATABASE_URL" -f sql/queries/QRY_012__places_with_activity.sql

SELECT
    pl.display_name AS place,
    pl.formatted_address,
    pl.has_trapping_activity,
    pl.has_appointment_activity,
    pl.has_cat_activity,
    pl.effective_type,
    COUNT(DISTINCT ppr.person_id) AS connected_people,
    (SELECT COUNT(*) FROM trapper.sot_addresses sa WHERE sa.place_id = pl.place_id) AS geocoded_addresses
FROM trapper.places pl
LEFT JOIN trapper.person_place_relationships ppr ON ppr.place_id = pl.place_id
GROUP BY pl.place_id, pl.display_name, pl.formatted_address,
         pl.has_trapping_activity, pl.has_appointment_activity,
         pl.has_cat_activity, pl.effective_type
ORDER BY connected_people DESC, geocoded_addresses DESC
LIMIT 25;

\echo ''
\echo 'Places summary:'
SELECT
    COUNT(*) AS total_places,
    COUNT(*) FILTER (WHERE has_trapping_activity) AS with_trapping,
    COUNT(*) FILTER (WHERE has_appointment_activity) AS with_appt,
    COUNT(*) FILTER (WHERE has_cat_activity) AS with_cat
FROM trapper.places;
