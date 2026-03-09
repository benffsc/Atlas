-- MIG_2894: Handle ClinicHQ Death Type Field (FFS-401)
--
-- PROBLEM: ClinicHQ exports include a 'Death Type' field ('Pre-operative', 'Post-operative')
-- but the ingest pipeline completely ignores it. Mortality detection only searched
-- medical_notes text for keywords like "euthanized", "died". Cats with Death Type
-- were not being marked as deceased automatically.
--
-- ALSO FIXED: Existing mortality detection code in route.ts used V1 column names
-- (death_date, death_cause, death_date_precision, etc.) instead of V2 names
-- (event_date, mortality_type, cause). The code was silently failing in try-catch.
--
-- CHANGES:
-- 1. Add death_type column to ops.appointments
-- 2. Backfill from staged_records
-- 3. Create mortality events for appointments with death_type
-- 4. Mark affected cats as deceased
--
-- Created: 2026-03-09
-- Fixes: FFS-401

\echo ''
\echo '=============================================='
\echo '  MIG_2894: Handle ClinicHQ Death Type'
\echo '=============================================='
\echo ''

-- ============================================================================
-- 1. ADD death_type COLUMN TO ops.appointments
-- ============================================================================

\echo '1. Adding death_type column to ops.appointments...'

ALTER TABLE ops.appointments
  ADD COLUMN IF NOT EXISTS death_type TEXT;

COMMENT ON COLUMN ops.appointments.death_type IS
'ClinicHQ Death Type field: Pre-operative, Post-operative, or NULL.
Added in MIG_2894 (FFS-401).';

\echo '   Added death_type column'

-- ============================================================================
-- 2. BACKFILL death_type FROM staged_records
-- ============================================================================

\echo ''
\echo '2. Backfilling death_type from staged_records...'

UPDATE ops.appointments a
SET death_type = NULLIF(TRIM(sr.payload->>'Death Type'), '')
FROM ops.staged_records sr
WHERE sr.source_system = 'clinichq'
  AND sr.source_table = 'appointment_info'
  AND sr.payload->>'Number' = a.appointment_number
  AND sr.payload->>'Death Type' IS NOT NULL
  AND TRIM(sr.payload->>'Death Type') != ''
  AND a.death_type IS NULL;

\echo '   Backfilled death_type'

-- ============================================================================
-- 3. CREATE mortality events for death_type appointments
-- ============================================================================

\echo ''
\echo '3. Creating mortality events from death_type...'

WITH death_type_appointments AS (
  SELECT DISTINCT ON (a.cat_id)
    a.appointment_id,
    a.appointment_date,
    a.cat_id,
    a.death_type,
    CASE
      WHEN LOWER(a.death_type) LIKE '%pre%' THEN 'pre_operative'
      WHEN LOWER(a.death_type) LIKE '%post%' THEN 'post_operative'
      ELSE 'unspecified'
    END AS mortality_timing
  FROM ops.appointments a
  JOIN sot.cats c ON c.cat_id = a.cat_id
  LEFT JOIN sot.cat_mortality_events me ON me.cat_id = a.cat_id
  WHERE a.death_type IS NOT NULL
    AND TRIM(a.death_type) != ''
    AND me.event_id IS NULL
  ORDER BY a.cat_id, a.appointment_date DESC
)
INSERT INTO sot.cat_mortality_events (
  cat_id, mortality_type, event_date, cause,
  mortality_timing, source_system, source_record_id, notes
)
SELECT
  cat_id, 'euthanasia', appointment_date, 'clinichq_death_type',
  mortality_timing, 'clinichq', appointment_id::TEXT,
  'Auto-created from ClinicHQ Death Type: ' || death_type
FROM death_type_appointments
ON CONFLICT (cat_id, event_date, mortality_type) DO NOTHING;

\echo '   Created mortality events'

-- ============================================================================
-- 4. MARK cats as deceased
-- ============================================================================

\echo ''
\echo '4. Marking cats with mortality events as deceased...'

UPDATE sot.cats c
SET is_deceased = true,
    deceased_at = me.event_date::timestamptz,
    updated_at = NOW()
FROM sot.cat_mortality_events me
WHERE c.cat_id = me.cat_id
  AND (c.is_deceased IS NULL OR c.is_deceased = false);

-- ============================================================================
-- 5. VERIFICATION
-- ============================================================================

\echo ''
\echo '=============================================='
\echo '  VERIFICATION'
\echo '=============================================='

\echo ''
\echo '5a. Appointments with death_type:'
SELECT death_type, COUNT(*) as count
FROM ops.appointments
WHERE death_type IS NOT NULL
GROUP BY death_type
ORDER BY count DESC;

\echo ''
\echo '5b. Mortality events by source:'
SELECT source_system, COUNT(*) as count
FROM sot.cat_mortality_events
GROUP BY source_system
ORDER BY count DESC;

\echo ''
\echo '5c. Deceased cats:'
SELECT COUNT(*) as deceased_cats
FROM sot.cats
WHERE is_deceased = true
  AND merged_into_cat_id IS NULL;

\echo ''
\echo '=============================================='
\echo '  MIG_2894 Complete'
\echo '=============================================='
\echo ''
