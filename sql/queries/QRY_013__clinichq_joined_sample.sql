-- QRY_013__clinichq_joined_sample.sql
-- ClinicHQ joined sample rows (cat + owner + appointment)
--
-- Shows joined ClinicHQ data with animal info, owner details,
-- and most recent appointment.
--
-- Usage:
--   psql "$DATABASE_URL" -f sql/queries/QRY_013__clinichq_joined_sample.sql

SELECT
    animal_number,
    animal_name,
    breed,
    sex,
    spay_neuter_status,
    owner_first_name || ' ' || owner_last_name AS owner_name,
    LEFT(owner_address, 50) AS address_preview,
    owner_email,
    owner_phone,
    appt_date AS last_appt,
    vet_name
FROM trapper.v_clinichq_joined_simple
WHERE owner_first_name IS NOT NULL
  AND owner_address IS NOT NULL
ORDER BY appt_date DESC NULLS LAST
LIMIT 20;

\echo ''
\echo 'ClinicHQ stats:'
SELECT * FROM trapper.v_clinichq_stats;

\echo ''
\echo 'Join coverage:'
SELECT
    COUNT(*) AS total_cats,
    COUNT(owner_first_name) AS with_owner,
    COUNT(owner_address) AS with_address,
    COUNT(appt_date) AS with_appt
FROM trapper.v_clinichq_joined_simple;
