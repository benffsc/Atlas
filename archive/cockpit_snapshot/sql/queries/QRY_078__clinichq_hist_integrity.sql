-- QRY_078__clinichq_hist_integrity.sql
-- Integrity and sanity checks for ClinicHQ historical tables
--
-- Usage:
--   export PATH="/opt/homebrew/Cellar/libpq/18.1/bin:$PATH"
--   set -a && source .env && set +a
--   psql "$DATABASE_URL" -f sql/queries/QRY_078__clinichq_hist_integrity.sql

\pset pager off
\echo '=============================================='
\echo 'CLINICHQ HISTORICAL DATA INTEGRITY CHECKS'
\echo '=============================================='

-- ============================================
-- 1) ROW COUNTS
-- ============================================
\echo ''
\echo '--- 1) Row Counts ---'

SELECT
    'clinichq_hist_appts' AS table_name,
    COUNT(*) AS rows
FROM trapper.clinichq_hist_appts
UNION ALL
SELECT 'clinichq_hist_cats', COUNT(*) FROM trapper.clinichq_hist_cats
UNION ALL
SELECT 'clinichq_hist_owners', COUNT(*) FROM trapper.clinichq_hist_owners
ORDER BY table_name;

-- ============================================
-- 2) DATE RANGES
-- ============================================
\echo ''
\echo '--- 2) Date Ranges ---'

SELECT
    'clinichq_hist_appts' AS table_name,
    MIN(appt_date)::text AS min_date,
    MAX(appt_date)::text AS max_date,
    COUNT(DISTINCT appt_date) AS unique_dates
FROM trapper.clinichq_hist_appts
UNION ALL
SELECT
    'clinichq_hist_cats',
    MIN(appt_date)::text,
    MAX(appt_date)::text,
    COUNT(DISTINCT appt_date)
FROM trapper.clinichq_hist_cats
UNION ALL
SELECT
    'clinichq_hist_owners',
    MIN(appt_date)::text,
    MAX(appt_date)::text,
    COUNT(DISTINCT appt_date)
FROM trapper.clinichq_hist_owners
ORDER BY table_name;

-- ============================================
-- 3) MISSING KEY IDENTIFIERS
-- ============================================
\echo ''
\echo '--- 3) Missing Key Identifiers (%) ---'

SELECT
    'appts - null appt_number' AS check_name,
    ROUND(100.0 * COUNT(*) FILTER (WHERE appt_number IS NULL) / NULLIF(COUNT(*), 0), 2) AS pct
FROM trapper.clinichq_hist_appts
UNION ALL
SELECT
    'appts - null microchip',
    ROUND(100.0 * COUNT(*) FILTER (WHERE microchip_number IS NULL OR microchip_number = '') / NULLIF(COUNT(*), 0), 2)
FROM trapper.clinichq_hist_appts
UNION ALL
SELECT
    'appts - null animal_name',
    ROUND(100.0 * COUNT(*) FILTER (WHERE animal_name IS NULL OR animal_name = '') / NULLIF(COUNT(*), 0), 2)
FROM trapper.clinichq_hist_appts
UNION ALL
SELECT
    'cats - null microchip',
    ROUND(100.0 * COUNT(*) FILTER (WHERE microchip_number IS NULL OR microchip_number = '') / NULLIF(COUNT(*), 0), 2)
FROM trapper.clinichq_hist_cats
UNION ALL
SELECT
    'owners - null owner_name',
    ROUND(100.0 * COUNT(*) FILTER (WHERE owner_first_name IS NULL AND owner_last_name IS NULL) / NULLIF(COUNT(*), 0), 2)
FROM trapper.clinichq_hist_owners
UNION ALL
SELECT
    'owners - null phone_normalized',
    ROUND(100.0 * COUNT(*) FILTER (WHERE phone_normalized IS NULL) / NULLIF(COUNT(*), 0), 2)
FROM trapper.clinichq_hist_owners
UNION ALL
SELECT
    'owners - null email',
    ROUND(100.0 * COUNT(*) FILTER (WHERE owner_email IS NULL OR owner_email = '') / NULLIF(COUNT(*), 0), 2)
FROM trapper.clinichq_hist_owners
ORDER BY check_name;

-- ============================================
-- 4) DUPLICATE CHECK (by source_file, source_row_hash)
-- ============================================
\echo ''
\echo '--- 4) Duplicate Check (should all be 0) ---'

SELECT
    'clinichq_hist_appts' AS table_name,
    COUNT(*) - COUNT(DISTINCT (source_file, source_row_hash)) AS duplicates
FROM trapper.clinichq_hist_appts
UNION ALL
SELECT
    'clinichq_hist_cats',
    COUNT(*) - COUNT(DISTINCT (source_file, source_row_hash))
FROM trapper.clinichq_hist_cats
UNION ALL
SELECT
    'clinichq_hist_owners',
    COUNT(*) - COUNT(DISTINCT (source_file, source_row_hash))
FROM trapper.clinichq_hist_owners
ORDER BY table_name;

-- ============================================
-- 5) JOINABILITY CHECK (appts <-> cats <-> owners)
-- ============================================
\echo ''
\echo '--- 5) Joinability Check (by appt_number) ---'

WITH appt_numbers AS (
    SELECT DISTINCT appt_number FROM trapper.clinichq_hist_appts WHERE appt_number IS NOT NULL
),
cat_numbers AS (
    SELECT DISTINCT appt_number FROM trapper.clinichq_hist_cats WHERE appt_number IS NOT NULL
),
owner_numbers AS (
    SELECT DISTINCT appt_number FROM trapper.clinichq_hist_owners WHERE appt_number IS NOT NULL
)
SELECT
    (SELECT COUNT(*) FROM appt_numbers) AS appt_unique_numbers,
    (SELECT COUNT(*) FROM cat_numbers) AS cat_unique_numbers,
    (SELECT COUNT(*) FROM owner_numbers) AS owner_unique_numbers,
    (SELECT COUNT(*) FROM appt_numbers a JOIN cat_numbers c ON a.appt_number = c.appt_number) AS appts_with_cats,
    (SELECT COUNT(*) FROM appt_numbers a JOIN owner_numbers o ON a.appt_number = o.appt_number) AS appts_with_owners;

-- ============================================
-- 6) MICROCHIP COVERAGE & MATCHING
-- ============================================
\echo ''
\echo '--- 6) Microchip Coverage ---'

SELECT
    'clinichq_hist_appts' AS table_name,
    COUNT(*) AS total,
    COUNT(*) FILTER (WHERE microchip_number IS NOT NULL AND microchip_number != '') AS with_microchip,
    ROUND(100.0 * COUNT(*) FILTER (WHERE microchip_number IS NOT NULL AND microchip_number != '') / NULLIF(COUNT(*), 0), 1) AS pct
FROM trapper.clinichq_hist_appts
UNION ALL
SELECT
    'clinichq_hist_cats',
    COUNT(*),
    COUNT(*) FILTER (WHERE microchip_number IS NOT NULL AND microchip_number != ''),
    ROUND(100.0 * COUNT(*) FILTER (WHERE microchip_number IS NOT NULL AND microchip_number != '') / NULLIF(COUNT(*), 0), 1)
FROM trapper.clinichq_hist_cats
UNION ALL
SELECT
    'clinichq_hist_owners',
    COUNT(*),
    COUNT(*) FILTER (WHERE microchip_number IS NOT NULL AND microchip_number != ''),
    ROUND(100.0 * COUNT(*) FILTER (WHERE microchip_number IS NOT NULL AND microchip_number != '') / NULLIF(COUNT(*), 0), 1)
FROM trapper.clinichq_hist_owners
ORDER BY table_name;

-- ============================================
-- 7) CLIENT TYPE DISTRIBUTION (owners)
-- ============================================
\echo ''
\echo '--- 7) Client Type Distribution (owners) ---'

SELECT
    COALESCE(client_type, '(null)') AS client_type,
    COUNT(*) AS count
FROM trapper.clinichq_hist_owners
GROUP BY client_type
ORDER BY count DESC
LIMIT 10;

-- ============================================
-- 8) SURGERY TYPE DISTRIBUTION (appts)
-- ============================================
\echo ''
\echo '--- 8) Surgery Type Distribution (appts) ---'

SELECT
    'spay' AS surgery_type, COUNT(*) FILTER (WHERE spay = true) AS count FROM trapper.clinichq_hist_appts
UNION ALL
SELECT 'neuter', COUNT(*) FILTER (WHERE neuter = true) FROM trapper.clinichq_hist_appts
UNION ALL
SELECT 'cryptorchid', COUNT(*) FILTER (WHERE cryptorchid = true) FROM trapper.clinichq_hist_appts
UNION ALL
SELECT 'pregnant', COUNT(*) FILTER (WHERE pregnant = true) FROM trapper.clinichq_hist_appts
UNION ALL
SELECT 'pyometra', COUNT(*) FILTER (WHERE pyometra = true) FROM trapper.clinichq_hist_appts
ORDER BY count DESC;

-- ============================================
-- 9) SAMPLE RECORDS
-- ============================================
\echo ''
\echo '--- 9) Sample Records ---'

\echo 'Sample appts:'
SELECT appt_date, appt_number, animal_name, microchip_number, vet_name
FROM trapper.clinichq_hist_appts
ORDER BY appt_date DESC
LIMIT 3;

\echo ''
\echo 'Sample cats:'
SELECT appt_date, appt_number, animal_name, breed, sex, primary_color
FROM trapper.clinichq_hist_cats
ORDER BY appt_date DESC
LIMIT 3;

\echo ''
\echo 'Sample owners:'
SELECT appt_date, appt_number, owner_first_name, owner_last_name, phone_normalized, owner_email
FROM trapper.clinichq_hist_owners
ORDER BY appt_date DESC
LIMIT 3;

-- ============================================
-- 10) HEALTH SUMMARY
-- ============================================
\echo ''
\echo '--- 10) Health Summary ---'

SELECT
    CASE
        WHEN (SELECT COUNT(*) FROM trapper.clinichq_hist_appts) > 0
             AND (SELECT COUNT(*) FROM trapper.clinichq_hist_cats) > 0
             AND (SELECT COUNT(*) FROM trapper.clinichq_hist_owners) > 0
        THEN 'HEALTHY - All tables have data'
        WHEN (SELECT COUNT(*) FROM trapper.clinichq_hist_appts) = 0
             AND (SELECT COUNT(*) FROM trapper.clinichq_hist_cats) = 0
             AND (SELECT COUNT(*) FROM trapper.clinichq_hist_owners) = 0
        THEN 'EMPTY - No data ingested yet. Run: python3 ingest_clinichq_historical.py --all'
        ELSE 'PARTIAL - Some tables empty. Check ingest.'
    END AS health_status;

\echo ''
\echo '=============================================='
\echo 'CLINICHQ HISTORICAL INTEGRITY CHECK COMPLETE'
\echo '=============================================='
