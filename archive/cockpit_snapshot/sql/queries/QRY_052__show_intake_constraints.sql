-- QRY_052__show_intake_constraints.sql
-- Show UNIQUE constraint definitions for intake tables
-- Highlights whether the composite key constraint exists

\pset pager off

\echo '=== Intake Table Constraints ==='
SELECT
    c.conrelid::regclass AS table_name,
    c.conname AS constraint_name,
    CASE c.contype
        WHEN 'p' THEN 'PRIMARY KEY'
        WHEN 'u' THEN 'UNIQUE'
    END AS constraint_type,
    pg_get_constraintdef(c.oid) AS constraint_definition,
    CASE
        WHEN c.conname LIKE '%uq_source_system_row_hash%' THEN '*** COMPOSITE KEY ***'
        ELSE ''
    END AS is_composite_key
FROM pg_constraint c
JOIN pg_namespace n ON c.connamespace = n.oid
WHERE n.nspname = 'trapper'
  AND c.conrelid::regclass::text IN (
      'trapper.appointment_requests',
      'trapper.clinichq_upcoming_appointments'
  )
  AND c.contype IN ('u', 'p')
ORDER BY table_name, constraint_name;

\echo ''
\echo '=== Composite Key Check ==='
SELECT
    'appointment_requests' AS table_name,
    EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'appointment_requests__uq_source_system_row_hash'
          AND conrelid = 'trapper.appointment_requests'::regclass
    ) AS composite_key_exists
UNION ALL
SELECT
    'clinichq_upcoming_appointments',
    EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'clinichq_upcoming_appointments__uq_source_system_row_hash'
          AND conrelid = 'trapper.clinichq_upcoming_appointments'::regclass
    );
