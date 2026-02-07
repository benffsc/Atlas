-- ============================================================================
-- MIG_903: Unresolvable Appointment Tracking
-- ============================================================================
-- Purpose: Track appointments that cannot be linked due to missing source data.
-- This addresses Gap A from the data quality ledger.
--
-- Key finding: 4,331 appointments have no microchip in source (ClinicHQ).
-- These cannot be auto-linked and require:
--   1. Manual review for important cases
--   2. ClinicHQ data cleanup for future appointments
-- ============================================================================

\echo '=== MIG_903: Unresolvable Appointment Tracking ==='
\echo ''

-- ============================================================================
-- View 1: Detailed breakdown of unresolvable appointments
-- ============================================================================

\echo 'Creating v_unresolvable_appointment_breakdown view...'

CREATE OR REPLACE VIEW trapper.v_unresolvable_appointment_breakdown AS
WITH appointment_analysis AS (
  SELECT
    a.appointment_id,
    a.appointment_number,
    a.appointment_date,
    EXTRACT(YEAR FROM a.appointment_date)::INT as year,
    a.service_type,
    a.is_spay,
    a.is_neuter,
    a.cat_id,
    a.person_id,
    -- Raw microchip from staged record
    NULLIF(TRIM(sr.payload->>'Microchip Number'), '') as raw_microchip,
    -- Cat gap reason
    CASE
      WHEN a.cat_id IS NOT NULL THEN 'linked'
      WHEN NULLIF(TRIM(sr.payload->>'Microchip Number'), '') IS NULL THEN 'no_microchip_in_source'
      WHEN NOT EXISTS (
        SELECT 1 FROM trapper.cat_identifiers ci
        WHERE ci.id_type = 'microchip'
          AND ci.id_value = TRIM(sr.payload->>'Microchip Number')
      ) THEN 'microchip_not_in_database'
      ELSE 'unknown_cat_gap'
    END as cat_gap_reason,
    -- Service category
    CASE
      WHEN a.is_spay OR a.is_neuter THEN 'tnr'
      WHEN a.service_type ILIKE '%exam%' THEN 'exam'
      WHEN a.service_type ILIKE '%recheck%' THEN 'recheck'
      WHEN a.service_type ILIKE '%euthanasia%' THEN 'euthanasia'
      ELSE 'other'
    END as service_category,
    -- Is this high priority? (TNR without cat link is more concerning)
    CASE
      WHEN a.cat_id IS NULL AND (a.is_spay OR a.is_neuter) THEN TRUE
      ELSE FALSE
    END as is_high_priority
  FROM trapper.sot_appointments a
  LEFT JOIN trapper.staged_records sr ON
    sr.source_system = 'clinichq'
    AND sr.source_table = 'appointment_info'
    AND sr.payload->>'Number' = a.appointment_number
    AND TO_DATE(sr.payload->>'Date', 'MM/DD/YYYY') = a.appointment_date
)
SELECT
  year,
  service_category,
  cat_gap_reason,
  COUNT(*) as appointment_count,
  COUNT(*) FILTER (WHERE is_high_priority) as high_priority_count
FROM appointment_analysis
WHERE cat_gap_reason != 'linked'
GROUP BY year, service_category, cat_gap_reason
ORDER BY year DESC, high_priority_count DESC, appointment_count DESC;

COMMENT ON VIEW trapper.v_unresolvable_appointment_breakdown IS
'Breaks down unresolvable appointments by year, service category, and gap reason.
Helps identify patterns and prioritize manual review.

Key columns:
  - cat_gap_reason: Why the cat is not linked (no_microchip_in_source, microchip_not_in_database, unknown)
  - service_category: Type of service (tnr, exam, recheck, euthanasia, other)
  - high_priority_count: TNR appointments without cat link (most concerning)

Main finding: ~4,300 appointments have no microchip in ClinicHQ source data.
These are data entry gaps at the clinic, not Atlas bugs.';

-- ============================================================================
-- View 2: Sample unresolvable appointments for manual review
-- ============================================================================

\echo ''
\echo 'Creating v_unresolvable_appointments_sample view...'

CREATE OR REPLACE VIEW trapper.v_unresolvable_appointments_sample AS
SELECT
  a.appointment_id,
  a.appointment_number,
  a.appointment_date,
  a.service_type,
  CASE WHEN a.is_spay THEN 'Spay' WHEN a.is_neuter THEN 'Neuter' ELSE 'Other' END as procedure_type,
  -- Cat info from raw payload (for manual lookup)
  sr.payload->>'Animal Name' as raw_animal_name,
  sr.payload->>'Breed' as raw_breed,
  sr.payload->>'Primary Color' as raw_color,
  sr.payload->>'Microchip Number' as raw_microchip,
  -- Owner info for context
  sr.payload->>'Owner First Name' as raw_owner_first,
  sr.payload->>'Owner Last Name' as raw_owner_last,
  a.owner_email,
  a.owner_phone,
  -- Gap classification
  CASE
    WHEN NULLIF(TRIM(sr.payload->>'Microchip Number'), '') IS NULL THEN 'no_microchip_in_source'
    ELSE 'microchip_not_in_database'
  END as gap_reason
FROM trapper.sot_appointments a
LEFT JOIN trapper.staged_records sr ON
  sr.source_system = 'clinichq'
  AND sr.source_table = 'appointment_info'
  AND sr.payload->>'Number' = a.appointment_number
  AND TO_DATE(sr.payload->>'Date', 'MM/DD/YYYY') = a.appointment_date
WHERE a.cat_id IS NULL
  AND (a.is_spay OR a.is_neuter)  -- Focus on TNR appointments
ORDER BY a.appointment_date DESC
LIMIT 100;

COMMENT ON VIEW trapper.v_unresolvable_appointments_sample IS
'Sample of recent unresolvable TNR appointments for manual review.
Shows raw ClinicHQ data to help staff identify the cat manually.

Use this to:
  1. Identify cats that should have been microchipped
  2. Match appointments to existing cats by name/color/owner
  3. Flag ClinicHQ data entry issues to fix at source';

-- ============================================================================
-- Summary statistics
-- ============================================================================

\echo ''
\echo 'Summary of unresolvable appointments:'

SELECT
  cat_gap_reason,
  COUNT(*) as total_count,
  COUNT(*) FILTER (WHERE is_spay OR is_neuter) as tnr_count,
  MIN(appointment_date) as earliest,
  MAX(appointment_date) as latest
FROM (
  SELECT
    a.appointment_id,
    a.appointment_date,
    a.is_spay,
    a.is_neuter,
    CASE
      WHEN a.cat_id IS NOT NULL THEN 'linked'
      WHEN NULLIF(TRIM(sr.payload->>'Microchip Number'), '') IS NULL THEN 'no_microchip_in_source'
      ELSE 'other'
    END as cat_gap_reason
  FROM trapper.sot_appointments a
  LEFT JOIN trapper.staged_records sr ON
    sr.source_system = 'clinichq'
    AND sr.source_table = 'appointment_info'
    AND sr.payload->>'Number' = a.appointment_number
    AND TO_DATE(sr.payload->>'Date', 'MM/DD/YYYY') = a.appointment_date
) sub
WHERE cat_gap_reason != 'linked'
GROUP BY cat_gap_reason;

-- ============================================================================
-- Summary
-- ============================================================================

\echo ''
\echo '=============================================='
\echo 'MIG_903 Complete!'
\echo '=============================================='
\echo ''
\echo 'Created views for tracking unresolvable appointments:'
\echo '  1. v_unresolvable_appointment_breakdown - By year/service/reason'
\echo '  2. v_unresolvable_appointments_sample - Recent TNR samples for review'
\echo ''
\echo 'Key finding: Most unresolvable appointments are due to missing'
\echo 'microchip data in ClinicHQ source. This is a clinic data entry'
\echo 'issue, not an Atlas bug. Solutions:'
\echo '  1. Train staff to always enter microchip numbers'
\echo '  2. Add validation to ClinicHQ forms'
\echo '  3. Manual review for high-priority TNR cases'
\echo ''
