-- QRY_080__clinichq_hist_health_report.sql
-- Comprehensive health report for ClinicHQ historical tables
--
-- Covers: row counts, date ranges, year distribution, identifier coverage,
--         duplicate detection, joinability, and top microchip duplicates.
--
-- Usage:
--   export PATH="/opt/homebrew/Cellar/libpq/18.1/bin:$PATH"
--   set -a && source .env && set +a
--   psql "$DATABASE_URL" -f sql/queries/QRY_080__clinichq_hist_health_report.sql

\pset pager off
\echo '=========================================================='
\echo 'CLINICHQ HISTORICAL HEALTH REPORT'
\echo '=========================================================='

-- ============================================
-- 1) ROW COUNTS
-- ============================================
\echo ''
\echo '--- 1) Row Counts ---'

SELECT
    'clinichq_hist_appts' AS table_name,
    COUNT(*)::text AS rows
FROM trapper.clinichq_hist_appts
UNION ALL
SELECT 'clinichq_hist_cats', COUNT(*)::text FROM trapper.clinichq_hist_cats
UNION ALL
SELECT 'clinichq_hist_owners', COUNT(*)::text FROM trapper.clinichq_hist_owners
ORDER BY table_name;

-- ============================================
-- 2) DATE RANGES (min/max)
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
-- 3) YEAR DISTRIBUTION (coarse)
-- ============================================
\echo ''
\echo '--- 3) Year Distribution (appts) ---'

SELECT
    EXTRACT(YEAR FROM appt_date)::int AS year,
    COUNT(*) AS appt_count
FROM trapper.clinichq_hist_appts
WHERE appt_date IS NOT NULL
GROUP BY EXTRACT(YEAR FROM appt_date)
ORDER BY year;

-- ============================================
-- 4) MISSING CRITICAL IDENTIFIERS (%)
-- ============================================
\echo ''
\echo '--- 4) Missing Critical Identifiers (%) ---'

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
    'cats - null appt_number',
    ROUND(100.0 * COUNT(*) FILTER (WHERE appt_number IS NULL) / NULLIF(COUNT(*), 0), 2)
FROM trapper.clinichq_hist_cats
UNION ALL
SELECT
    'cats - null microchip',
    ROUND(100.0 * COUNT(*) FILTER (WHERE microchip_number IS NULL OR microchip_number = '') / NULLIF(COUNT(*), 0), 2)
FROM trapper.clinichq_hist_cats
UNION ALL
SELECT
    'owners - null appt_number',
    ROUND(100.0 * COUNT(*) FILTER (WHERE appt_number IS NULL) / NULLIF(COUNT(*), 0), 2)
FROM trapper.clinichq_hist_owners
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
-- 5) DUPLICATE DETECTION (by source_row_hash)
-- ============================================
\echo ''
\echo '--- 5) Duplicate Detection (should all be 0) ---'

SELECT
    'clinichq_hist_appts' AS table_name,
    COUNT(*) - COUNT(DISTINCT (source_file, source_row_hash)) AS hash_duplicates
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
-- 6) JOINABILITY CHECKS (appt_number key)
-- ============================================
\echo ''
\echo '--- 6) Joinability Checks (by appt_number) ---'

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
    (SELECT COUNT(*) FROM appt_numbers a JOIN cat_numbers c ON a.appt_number = c.appt_number) AS appts_joined_cats,
    (SELECT COUNT(*) FROM appt_numbers a JOIN owner_numbers o ON a.appt_number = o.appt_number) AS appts_joined_owners,
    (SELECT COUNT(*) FROM cat_numbers c JOIN owner_numbers o ON c.appt_number = o.appt_number) AS cats_joined_owners;

-- ============================================
-- 7) TOP 20 MICROCHIP DUPLICATES (if any)
-- ============================================
\echo ''
\echo '--- 7) Top 20 Microchips with Multiple Appointments ---'

SELECT
    microchip_number,
    COUNT(*) AS appt_count,
    MIN(appt_date)::text AS first_appt,
    MAX(appt_date)::text AS last_appt
FROM trapper.clinichq_hist_appts
WHERE microchip_number IS NOT NULL AND microchip_number != ''
GROUP BY microchip_number
HAVING COUNT(*) > 1
ORDER BY COUNT(*) DESC
LIMIT 20;

-- ============================================
-- 8) SURGERY TYPE DISTRIBUTION
-- ============================================
\echo ''
\echo '--- 8) Surgery Type Distribution ---'

SELECT
    'spay' AS surgery_type, COUNT(*) FILTER (WHERE spay = true) AS count
FROM trapper.clinichq_hist_appts
UNION ALL SELECT 'neuter', COUNT(*) FILTER (WHERE neuter = true) FROM trapper.clinichq_hist_appts
UNION ALL SELECT 'cryptorchid', COUNT(*) FILTER (WHERE cryptorchid = true) FROM trapper.clinichq_hist_appts
UNION ALL SELECT 'pregnant', COUNT(*) FILTER (WHERE pregnant = true) FROM trapper.clinichq_hist_appts
UNION ALL SELECT 'pyometra', COUNT(*) FILTER (WHERE pyometra = true) FROM trapper.clinichq_hist_appts
UNION ALL SELECT 'no_surgery', COUNT(*) FILTER (WHERE no_surgery_reason IS NOT NULL AND no_surgery_reason != '') FROM trapper.clinichq_hist_appts
ORDER BY count DESC;

-- ============================================
-- 9) CLIENT TYPE DISTRIBUTION (owners)
-- ============================================
\echo ''
\echo '--- 9) Client Type Distribution ---'

SELECT
    COALESCE(client_type, '(null)') AS client_type,
    COUNT(*) AS count
FROM trapper.clinichq_hist_owners
GROUP BY client_type
ORDER BY count DESC
LIMIT 15;

-- ============================================
-- 10) SAMPLE RECENT RECORDS
-- ============================================
\echo ''
\echo '--- 10) Sample Records (most recent) ---'

\echo 'Appointments (last 3):'
SELECT appt_date, appt_number, animal_name, microchip_number, vet_name,
       CASE WHEN spay THEN 'Spay' WHEN neuter THEN 'Neuter' ELSE '-' END AS surgery
FROM trapper.clinichq_hist_appts
ORDER BY appt_date DESC NULLS LAST
LIMIT 3;

\echo ''
\echo 'Cats (last 3):'
SELECT appt_date, appt_number, animal_name, breed, sex, primary_color
FROM trapper.clinichq_hist_cats
ORDER BY appt_date DESC NULLS LAST
LIMIT 3;

\echo ''
\echo 'Owners (last 3):'
SELECT appt_date, appt_number, owner_first_name, owner_last_name, owner_email, phone_normalized
FROM trapper.clinichq_hist_owners
ORDER BY appt_date DESC NULLS LAST
LIMIT 3;

-- ============================================
-- 11) HEALTH SUMMARY
-- ============================================
\echo ''
\echo '--- 11) Health Summary ---'

SELECT
    CASE
        WHEN (SELECT COUNT(*) FROM trapper.clinichq_hist_appts) > 0
             AND (SELECT COUNT(*) FROM trapper.clinichq_hist_cats) > 0
             AND (SELECT COUNT(*) FROM trapper.clinichq_hist_owners) > 0
             AND (SELECT COUNT(*) - COUNT(DISTINCT (source_file, source_row_hash)) FROM trapper.clinichq_hist_appts) = 0
             AND (SELECT COUNT(*) - COUNT(DISTINCT (source_file, source_row_hash)) FROM trapper.clinichq_hist_cats) = 0
             AND (SELECT COUNT(*) - COUNT(DISTINCT (source_file, source_row_hash)) FROM trapper.clinichq_hist_owners) = 0
        THEN 'HEALTHY - All tables populated, no hash duplicates'
        WHEN (SELECT COUNT(*) FROM trapper.clinichq_hist_appts) = 0
             AND (SELECT COUNT(*) FROM trapper.clinichq_hist_cats) = 0
             AND (SELECT COUNT(*) FROM trapper.clinichq_hist_owners) = 0
        THEN 'EMPTY - No data. Run: python3 ingest_clinichq_historical.py --all'
        WHEN (SELECT COUNT(*) - COUNT(DISTINCT (source_file, source_row_hash)) FROM trapper.clinichq_hist_appts) > 0
             OR (SELECT COUNT(*) - COUNT(DISTINCT (source_file, source_row_hash)) FROM trapper.clinichq_hist_cats) > 0
             OR (SELECT COUNT(*) - COUNT(DISTINCT (source_file, source_row_hash)) FROM trapper.clinichq_hist_owners) > 0
        THEN 'WARNING - Hash duplicates detected (check ingest idempotency)'
        ELSE 'PARTIAL - Some tables empty. Check ingest logs.'
    END AS health_status;

\echo ''
\echo '=========================================================='
\echo 'CLINICHQ HISTORICAL HEALTH REPORT COMPLETE'
\echo '=========================================================='
