-- MIG_3032: Backfill last_confirmed_at from appointment dates
--
-- MIG_3022 added last_confirmed_at to sot.person_place and backfilled from
-- updated_at/created_at. This migration enriches the backfill using actual
-- appointment dates — if a person had an appointment at a place more recently
-- than the person_place.updated_at, that appointment date is a better
-- "last confirmed" timestamp.
--
-- FFS-1034: Address timeline enhancement
-- Created: 2026-03-31

\echo ''
\echo '=============================================='
\echo '  MIG_3032: Backfill last_confirmed_at from appointments'
\echo '=============================================='
\echo ''

\echo 'Before: Distribution of last_confirmed_at sources'
SELECT
  CASE
    WHEN pp.last_confirmed_at = pp.created_at THEN 'created_at only'
    WHEN pp.last_confirmed_at = pp.updated_at THEN 'updated_at'
    WHEN pp.last_confirmed_at > COALESCE(pp.updated_at, pp.created_at) THEN 'newer (live write path)'
    ELSE 'other'
  END AS source,
  COUNT(*) AS cnt
FROM sot.person_place pp
GROUP BY 1
ORDER BY 2 DESC;

\echo ''
\echo 'Backfilling from appointment dates...'

WITH best_appt AS (
  SELECT
    a.person_id,
    a.inferred_place_id AS place_id,
    MAX(a.appointment_date) AS max_appt_date
  FROM ops.appointments a
  WHERE a.person_id IS NOT NULL
    AND a.inferred_place_id IS NOT NULL
    AND a.appointment_date IS NOT NULL
  GROUP BY a.person_id, a.inferred_place_id
)
UPDATE sot.person_place pp
SET last_confirmed_at = ba.max_appt_date
FROM best_appt ba
WHERE pp.person_id = ba.person_id
  AND pp.place_id = ba.place_id
  AND (pp.last_confirmed_at IS NULL OR ba.max_appt_date > pp.last_confirmed_at);

\echo ''
\echo 'After: Distribution of last_confirmed_at sources'
SELECT
  CASE
    WHEN pp.last_confirmed_at = pp.created_at THEN 'created_at only'
    WHEN pp.last_confirmed_at = pp.updated_at THEN 'updated_at'
    WHEN pp.last_confirmed_at > COALESCE(pp.updated_at, pp.created_at) THEN 'newer (appointment or live)'
    ELSE 'other'
  END AS source,
  COUNT(*) AS cnt
FROM sot.person_place pp
GROUP BY 1
ORDER BY 2 DESC;

\echo ''
\echo 'Rows with last_confirmed_at still NULL (should be 0):'
SELECT COUNT(*) AS null_count FROM sot.person_place WHERE last_confirmed_at IS NULL;

\echo ''
\echo '=============================================='
\echo '  MIG_3032 Complete!'
\echo '=============================================='
\echo ''
