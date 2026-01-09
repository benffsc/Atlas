-- QRY_051__intake_idempotency_proof.sql
-- Proves idempotency by showing row counts vs distinct composite logical keys
-- Logical key = (source_system, source_row_hash)

\pset pager off

\echo '=== Idempotency Proof: appointment_requests ==='
SELECT
    'appointment_requests' AS table_name,
    COUNT(*) AS total_rows,
    COUNT(DISTINCT (source_system, source_row_hash)) AS distinct_composite_keys,
    COUNT(*) - COUNT(DISTINCT (source_system, source_row_hash)) AS duplicates,
    MIN(submitted_at)::date AS min_submitted,
    MAX(submitted_at)::date AS max_submitted
FROM trapper.appointment_requests;

\echo ''
\echo '=== Idempotency Proof: clinichq_upcoming_appointments ==='
SELECT
    'clinichq_upcoming_appointments' AS table_name,
    COUNT(*) AS total_rows,
    COUNT(DISTINCT (source_system, source_row_hash)) AS distinct_composite_keys,
    COUNT(*) - COUNT(DISTINCT (source_system, source_row_hash)) AS duplicates,
    MIN(appt_date) AS min_appt_date,
    MAX(appt_date) AS max_appt_date
FROM trapper.clinichq_upcoming_appointments;

\echo ''
\echo '=== Combined Summary (composite keys) ==='
SELECT
    SUM(total_rows) AS total_rows_all,
    SUM(distinct_keys) AS distinct_composite_keys_all,
    SUM(duplicates) AS duplicates_all
FROM (
    SELECT COUNT(*) AS total_rows,
           COUNT(DISTINCT (source_system, source_row_hash)) AS distinct_keys,
           COUNT(*) - COUNT(DISTINCT (source_system, source_row_hash)) AS duplicates
    FROM trapper.appointment_requests
    UNION ALL
    SELECT COUNT(*),
           COUNT(DISTINCT (source_system, source_row_hash)),
           COUNT(*) - COUNT(DISTINCT (source_system, source_row_hash))
    FROM trapper.clinichq_upcoming_appointments
) t;

\echo ''
\echo '=== Source system + file breakdown ==='
SELECT source_system, source_file, COUNT(*) AS rows
FROM trapper.appointment_requests
GROUP BY source_system, source_file
ORDER BY source_system, source_file;

SELECT source_system, source_file, COUNT(*) AS rows
FROM trapper.clinichq_upcoming_appointments
GROUP BY source_system, source_file
ORDER BY source_system, source_file;
