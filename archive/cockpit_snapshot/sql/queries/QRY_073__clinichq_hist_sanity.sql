-- QRY_073__clinichq_hist_sanity.sql
-- Sanity checks for ClinicHQ historical tables after ingest
--
-- Usage:
--   export PATH="/opt/homebrew/Cellar/libpq/18.1/bin:$PATH"
--   set -a && source .env && set +a
--   psql "$DATABASE_URL" -f sql/queries/QRY_073__clinichq_hist_sanity.sql

\pset pager off
\echo '=============================================='
\echo 'CLINICHQ HISTORICAL DATA SANITY CHECKS'
\echo '=============================================='

-- ============================================
-- 1) ROW COUNTS
-- ============================================
\echo ''
\echo '--- 1) Row Counts ---'

SELECT 'clinichq_hist_appts' AS table_name, COUNT(*) AS rows FROM trapper.clinichq_hist_appts
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

SELECT 'clinichq_hist_appts' AS table_name,
       MIN(appt_date)::text AS min_date,
       MAX(appt_date)::text AS max_date,
       COUNT(DISTINCT appt_date) AS unique_dates
FROM trapper.clinichq_hist_appts
UNION ALL
SELECT 'clinichq_hist_cats',
       MIN(appt_date)::text,
       MAX(appt_date)::text,
       COUNT(DISTINCT appt_date)
FROM trapper.clinichq_hist_cats
UNION ALL
SELECT 'clinichq_hist_owners',
       MIN(appt_date)::text,
       MAX(appt_date)::text,
       COUNT(DISTINCT appt_date)
FROM trapper.clinichq_hist_owners
ORDER BY table_name;

-- ============================================
-- 3) DUPLICATE CHECK (should all be 0)
-- ============================================
\echo ''
\echo '--- 3) Duplicate Check (source_file, source_row_hash) ---'

SELECT 'clinichq_hist_appts' AS table_name,
       COUNT(*) - COUNT(DISTINCT (source_file, source_row_hash)) AS duplicates
FROM trapper.clinichq_hist_appts
UNION ALL
SELECT 'clinichq_hist_cats',
       COUNT(*) - COUNT(DISTINCT (source_file, source_row_hash))
FROM trapper.clinichq_hist_cats
UNION ALL
SELECT 'clinichq_hist_owners',
       COUNT(*) - COUNT(DISTINCT (source_file, source_row_hash))
FROM trapper.clinichq_hist_owners
ORDER BY table_name;

-- ============================================
-- 4) NULL CRITICAL FIELDS
-- ============================================
\echo ''
\echo '--- 4) Null Critical Fields ---'

SELECT 'clinichq_hist_appts' AS table_name,
       SUM(CASE WHEN appt_date IS NULL THEN 1 ELSE 0 END) AS null_date,
       SUM(CASE WHEN appt_number IS NULL THEN 1 ELSE 0 END) AS null_number,
       SUM(CASE WHEN animal_name IS NULL THEN 1 ELSE 0 END) AS null_animal,
       SUM(CASE WHEN microchip_number IS NULL THEN 1 ELSE 0 END) AS null_microchip
FROM trapper.clinichq_hist_appts
UNION ALL
SELECT 'clinichq_hist_cats',
       SUM(CASE WHEN appt_date IS NULL THEN 1 ELSE 0 END),
       SUM(CASE WHEN appt_number IS NULL THEN 1 ELSE 0 END),
       SUM(CASE WHEN animal_name IS NULL THEN 1 ELSE 0 END),
       SUM(CASE WHEN microchip_number IS NULL THEN 1 ELSE 0 END)
FROM trapper.clinichq_hist_cats
UNION ALL
SELECT 'clinichq_hist_owners',
       SUM(CASE WHEN appt_date IS NULL THEN 1 ELSE 0 END),
       SUM(CASE WHEN appt_number IS NULL THEN 1 ELSE 0 END),
       SUM(CASE WHEN animal_name IS NULL THEN 1 ELSE 0 END),
       SUM(CASE WHEN microchip_number IS NULL THEN 1 ELSE 0 END)
FROM trapper.clinichq_hist_owners
ORDER BY table_name;

-- ============================================
-- 5) MICROCHIP COVERAGE
-- ============================================
\echo ''
\echo '--- 5) Microchip Coverage ---'

SELECT 'clinichq_hist_appts' AS table_name,
       COUNT(*) FILTER (WHERE microchip_number IS NOT NULL AND microchip_number != '') AS with_microchip,
       COUNT(*) AS total,
       ROUND(100.0 * COUNT(*) FILTER (WHERE microchip_number IS NOT NULL AND microchip_number != '') / NULLIF(COUNT(*), 0), 1) AS pct
FROM trapper.clinichq_hist_appts
UNION ALL
SELECT 'clinichq_hist_cats',
       COUNT(*) FILTER (WHERE microchip_number IS NOT NULL AND microchip_number != ''),
       COUNT(*),
       ROUND(100.0 * COUNT(*) FILTER (WHERE microchip_number IS NOT NULL AND microchip_number != '') / NULLIF(COUNT(*), 0), 1)
FROM trapper.clinichq_hist_cats
UNION ALL
SELECT 'clinichq_hist_owners',
       COUNT(*) FILTER (WHERE microchip_number IS NOT NULL AND microchip_number != ''),
       COUNT(*),
       ROUND(100.0 * COUNT(*) FILTER (WHERE microchip_number IS NOT NULL AND microchip_number != '') / NULLIF(COUNT(*), 0), 1)
FROM trapper.clinichq_hist_owners
ORDER BY table_name;

-- ============================================
-- 6) OWNER CONTACT COVERAGE (owners table only)
-- ============================================
\echo ''
\echo '--- 6) Owner Contact Coverage ---'

SELECT
    'total_owners' AS metric,
    COUNT(*) AS count
FROM trapper.clinichq_hist_owners
UNION ALL
SELECT
    'with_email',
    COUNT(*) FILTER (WHERE owner_email IS NOT NULL AND owner_email != '')
FROM trapper.clinichq_hist_owners
UNION ALL
SELECT
    'with_any_phone',
    COUNT(*) FILTER (WHERE owner_phone IS NOT NULL OR owner_cell_phone IS NOT NULL)
FROM trapper.clinichq_hist_owners
UNION ALL
SELECT
    'with_normalized_phone',
    COUNT(*) FILTER (WHERE phone_normalized IS NOT NULL)
FROM trapper.clinichq_hist_owners
UNION ALL
SELECT
    'with_address',
    COUNT(*) FILTER (WHERE owner_address IS NOT NULL AND owner_address != '')
FROM trapper.clinichq_hist_owners;

-- ============================================
-- 7) SURGERY STATS (appts table only)
-- ============================================
\echo ''
\echo '--- 7) Surgery Stats (appts) ---'

SELECT
    'spay' AS surgery_type,
    COUNT(*) FILTER (WHERE spay = true) AS count
FROM trapper.clinichq_hist_appts
UNION ALL
SELECT
    'neuter',
    COUNT(*) FILTER (WHERE neuter = true)
FROM trapper.clinichq_hist_appts
UNION ALL
SELECT
    'cryptorchid',
    COUNT(*) FILTER (WHERE cryptorchid = true)
FROM trapper.clinichq_hist_appts
UNION ALL
SELECT
    'pregnant',
    COUNT(*) FILTER (WHERE pregnant = true)
FROM trapper.clinichq_hist_appts
UNION ALL
SELECT
    'pyometra',
    COUNT(*) FILTER (WHERE pyometra = true)
FROM trapper.clinichq_hist_appts;

-- ============================================
-- 8) BREED DISTRIBUTION (cats table only)
-- ============================================
\echo ''
\echo '--- 8) Top Breeds (cats) ---'

SELECT breed, COUNT(*) AS count
FROM trapper.clinichq_hist_cats
WHERE breed IS NOT NULL AND breed != ''
GROUP BY breed
ORDER BY count DESC
LIMIT 10;

-- ============================================
-- 9) CLIENT TYPE DISTRIBUTION (owners table)
-- ============================================
\echo ''
\echo '--- 9) Client Types (owners) ---'

SELECT client_type, COUNT(*) AS count
FROM trapper.clinichq_hist_owners
WHERE client_type IS NOT NULL
GROUP BY client_type
ORDER BY count DESC;

-- ============================================
-- 10) SAMPLE RECORDS
-- ============================================
\echo ''
\echo '--- 10) Sample Records ---'

\echo 'Sample appts (3):'
SELECT appt_date, appt_number, animal_name, microchip_number, vet_name
FROM trapper.clinichq_hist_appts
LIMIT 3;

\echo ''
\echo 'Sample cats (3):'
SELECT appt_date, appt_number, animal_name, breed, sex, primary_color
FROM trapper.clinichq_hist_cats
LIMIT 3;

\echo ''
\echo 'Sample owners (3):'
SELECT appt_date, appt_number, owner_first_name, owner_last_name, owner_email, phone_normalized
FROM trapper.clinichq_hist_owners
LIMIT 3;

\echo ''
\echo '=============================================='
\echo 'CLINICHQ HISTORICAL SANITY COMPLETE'
\echo '=============================================='
