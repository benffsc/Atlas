-- QRY_071__db_overview.sql
-- Comprehensive database health check for trapper schema
-- Referenced by: docs/SCHEMA_SNAPSHOT.md
--
-- Usage:
--   export PATH="/opt/homebrew/Cellar/libpq/18.1/bin:$PATH"
--   source .env && psql "$DATABASE_URL" -f sql/queries/QRY_071__db_overview.sql

\pset pager off
\echo '=============================================='
\echo 'TRAPPER SCHEMA HEALTH CHECK'
\echo '=============================================='
\echo ''

-- ============================================
-- 1) ROW COUNTS PER TABLE
-- ============================================
\echo '--- 1) ROW COUNTS ---'

SELECT 'people' AS table_name, COUNT(*) AS rows FROM trapper.people
UNION ALL SELECT 'places', COUNT(*) FROM trapper.places
UNION ALL SELECT 'addresses', COUNT(*) FROM trapper.addresses
UNION ALL SELECT 'requests', COUNT(*) FROM trapper.requests
UNION ALL SELECT 'request_parties', COUNT(*) FROM trapper.request_parties
UNION ALL SELECT 'appointment_requests', COUNT(*) FROM trapper.appointment_requests
UNION ALL SELECT 'clinichq_upcoming_appointments', COUNT(*) FROM trapper.clinichq_upcoming_appointments
UNION ALL SELECT 'clinic_sessions', COUNT(*) FROM trapper.clinic_sessions
UNION ALL SELECT 'clinic_visits', COUNT(*) FROM trapper.clinic_visits
UNION ALL SELECT 'planned_blocks', COUNT(*) FROM trapper.planned_blocks
UNION ALL SELECT 'events', COUNT(*) FROM trapper.events
UNION ALL SELECT 'app_config', COUNT(*) FROM trapper.app_config
ORDER BY table_name;

-- ============================================
-- 2) DATE RANGES FOR TIME-BASED TABLES
-- ============================================
\echo ''
\echo '--- 2) DATE RANGES ---'

SELECT 'clinichq_upcoming_appointments' AS table_name,
       MIN(appt_date)::text AS min_date,
       MAX(appt_date)::text AS max_date,
       COUNT(*) AS total_rows
FROM trapper.clinichq_upcoming_appointments
UNION ALL
SELECT 'appointment_requests',
       MIN(submitted_at::date)::text,
       MAX(submitted_at::date)::text,
       COUNT(*)
FROM trapper.appointment_requests
UNION ALL
SELECT 'requests',
       MIN(created_at::date)::text,
       MAX(created_at::date)::text,
       COUNT(*)
FROM trapper.requests
ORDER BY table_name;

-- ============================================
-- 3) DUPLICATE DETECTION (key fields)
-- ============================================
\echo ''
\echo '--- 3) DUPLICATE CHECK (should all be 0) ---'

SELECT 'people.person_key' AS field,
       COUNT(*) - COUNT(DISTINCT person_key) AS duplicates
FROM trapper.people
UNION ALL
SELECT 'places.place_key',
       COUNT(*) - COUNT(DISTINCT place_key)
FROM trapper.places
UNION ALL
SELECT 'addresses.address_key',
       COUNT(*) - COUNT(DISTINCT address_key)
FROM trapper.addresses
UNION ALL
SELECT 'requests.case_number',
       COUNT(*) - COUNT(DISTINCT case_number)
FROM trapper.requests
UNION ALL
SELECT 'appointment_requests.(source,hash)',
       COUNT(*) - COUNT(DISTINCT (source_system, source_row_hash))
FROM trapper.appointment_requests
UNION ALL
SELECT 'clinichq_upcoming.(source,hash)',
       COUNT(*) - COUNT(DISTINCT (source_system, source_row_hash))
FROM trapper.clinichq_upcoming_appointments;

-- ============================================
-- 4) FOREIGN KEY INTEGRITY (orphan check)
-- ============================================
\echo ''
\echo '--- 4) ORPHAN CHECK (should all be 0) ---'

SELECT 'requests with missing place' AS check_name,
       COUNT(*) AS orphans
FROM trapper.requests r
WHERE r.primary_place_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM trapper.places p WHERE p.id = r.primary_place_id)
UNION ALL
SELECT 'places with missing address',
       COUNT(*)
FROM trapper.places pl
WHERE pl.primary_address_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM trapper.addresses a WHERE a.id = pl.primary_address_id)
UNION ALL
SELECT 'request_parties with missing request',
       COUNT(*)
FROM trapper.request_parties rp
WHERE NOT EXISTS (SELECT 1 FROM trapper.requests r WHERE r.id = rp.request_id)
UNION ALL
SELECT 'request_parties with missing person',
       COUNT(*)
FROM trapper.request_parties rp
WHERE NOT EXISTS (SELECT 1 FROM trapper.people pe WHERE pe.id = rp.person_id);

-- ============================================
-- 5) UNIQUE CONSTRAINTS VERIFICATION
-- ============================================
\echo ''
\echo '--- 5) UNIQUE CONSTRAINTS (informational) ---'

SELECT
    tc.table_name,
    tc.constraint_name,
    string_agg(kcu.column_name, ', ' ORDER BY kcu.ordinal_position) AS columns
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu
    ON tc.constraint_name = kcu.constraint_name
    AND tc.table_schema = kcu.table_schema
WHERE tc.table_schema = 'trapper'
  AND tc.constraint_type = 'UNIQUE'
GROUP BY tc.table_name, tc.constraint_name
ORDER BY tc.table_name, tc.constraint_name;

-- ============================================
-- 6) GEOMETRY COVERAGE (PostGIS)
-- ============================================
\echo ''
\echo '--- 6) GEOMETRY COVERAGE ---'

SELECT 'addresses with geometry' AS metric,
       COUNT(*) FILTER (WHERE location IS NOT NULL) AS with_geom,
       COUNT(*) AS total,
       ROUND(100.0 * COUNT(*) FILTER (WHERE location IS NOT NULL) / NULLIF(COUNT(*), 0), 1) AS pct
FROM trapper.addresses
UNION ALL
SELECT 'places with geometry',
       COUNT(*) FILTER (WHERE location IS NOT NULL),
       COUNT(*),
       ROUND(100.0 * COUNT(*) FILTER (WHERE location IS NOT NULL) / NULLIF(COUNT(*), 0), 1)
FROM trapper.places;

-- ============================================
-- 7) QUICK DATA PREVIEW (last 3 from each intake)
-- ============================================
\echo ''
\echo '--- 7) RECENT INTAKE SAMPLES ---'

\echo 'Last 3 appointment_requests:'
SELECT id, submitted_at::date, requester_name, submission_status
FROM trapper.appointment_requests
ORDER BY created_at DESC
LIMIT 3;

\echo ''
\echo 'Last 3 clinichq_upcoming_appointments:'
SELECT id, appt_date, client_first_name, client_last_name, client_type
FROM trapper.clinichq_upcoming_appointments
ORDER BY created_at DESC
LIMIT 3;

\echo ''
\echo '=============================================='
\echo 'HEALTH CHECK COMPLETE'
\echo '=============================================='
